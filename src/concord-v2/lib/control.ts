/**
 * Concord V2 Control Plane — CORD-02 §5/§6/§9, CORD-04.
 *
 * Copied from Armada's control.ts. The Control Plane carries versioned,
 * real-npub-signed editions inside plaintext seals. `foldControlState` replays
 * the whole plane into current state in one pass.
 */

import type { NostrEvent } from "nostr-tools/pure";

import {
  banlistLocator,
  bytesToHex,
  controlGroupKey,
  dissolvedGroupKey,
  grantLocator,
  hex32,
  inviteLinksLocator,
  type GroupKey,
} from "@/concord-v2/lib/derive";
import {
  buildEditionRumor,
  parseEdition,
  toFoldEdition,
  type AuthorityCitation,
  type ParsedEdition,
} from "@/concord-v2/lib/edition";
import {
  KIND_SEAL_PLAINTEXT,
  VSK_BANLIST,
  VSK_CHANNEL,
  VSK_DISSOLVED,
  VSK_GRANT,
  VSK_INVITE_REGISTRY,
  VSK_METADATA,
  VSK_ROLE,
} from "@/concord-v2/lib/kinds";
import {
  canActOnPosition,
  emptyRoles,
  grantFromJSON,
  grantToJSON,
  hasPermission,
  highestPosition,
  isAuthorized,
  MAX_ROLES_PER_COMMUNITY,
  outranks,
  Permissions,
  roleFromJSON,
  roleToJSON,
  type CommunityRoles,
  type MemberGrant,
  type Role,
} from "@/concord-v2/lib/roles";
import { buildRumor, openWrap, sealRumor, wrapSeal, type OpenedEvent, type Rumor, type StreamSigner } from "@/concord-v2/lib/stream";
import {
  utf8Len,
  DESCRIPTION_MAX_BYTES,
  NAME_MAX_BYTES,
  capRelays,
  isImagePointer,
  type ChannelMetadata,
  type CommunityMetadata,
  type CommunityV2,
} from "@/concord-v2/lib/types";
import { bootstrapHead, fold, type Edition } from "@/concord-v2/lib/version";

// ── Addressing ───────────────────────────────────────────────────────────────

/** Every control-plane stream key across the community's held root epochs, newest first. */
export function controlGroups(community: CommunityV2): GroupKey[] {
  return community.heldRoots.map((r) => controlGroupKey(r.key, community.id, r.epoch));
}

/** The CURRENT control-plane stream key (where new editions publish). */
export function currentControlGroup(community: CommunityV2): GroupKey {
  return controlGroupKey(community.root, community.id, community.rootEpoch);
}

// ── Sealing / opening ────────────────────────────────────────────────────────

/** Sign (plaintext seal) + wrap one edition rumor for the control stream. */
export async function sealEdition(rumor: Rumor, control: GroupKey, signer: StreamSigner): Promise<NostrEvent> {
  const seal = await sealRumor(rumor, KIND_SEAL_PLAINTEXT, control, signer);
  return wrapSeal(seal, control);
}

/** Open every control wrap that decodes under one of `groups` into editions. */
export function openControlWraps(wraps: NostrEvent[], groups: GroupKey[]): ParsedEdition[] {
  const byPk = new Map(groups.map((g) => [g.pk, g]));
  const out: ParsedEdition[] = [];
  for (const wrap of wraps) {
    const group = byPk.get(wrap.pubkey);
    if (!group) continue;
    try {
      out.push(parseEdition(openWrap(wrap, group)));
    } catch {
      // not ours / malformed
    }
  }
  return out;
}

/** Parse already-OPENED control events into editions. */
export function openControlEditions(opened: OpenedEvent[]): ParsedEdition[] {
  const out: ParsedEdition[] = [];
  for (const ev of opened) {
    try {
      out.push(parseEdition(ev));
    } catch {
      // malformed
    }
  }
  return out;
}

// ── The one-pass fold ────────────────────────────────────────────────────────

export interface EntityHead {
  version: bigint;
  hash: Uint8Array;
}

/** One channel's folded definition. */
export interface FoldedChannel {
  channelIdHex: string;
  name: string;
  isPrivate: boolean;
  deleted: boolean;
  metadata: ChannelMetadata;
}

/** The Control Plane replayed into current state. */
export interface FoldedControl {
  roster: CommunityRoles;
  ownerHex: string;
  metadata?: CommunityMetadata;
  channels: Map<string, FoldedChannel>;
  banned: Set<string>;
  liveInviteLinks: Set<string>;
  registriesByCreator: Map<string, string[]>;
  heads: Map<string, EntityHead>;
  headEditions: Map<string, ParsedEdition>;
  incomplete: string[];
  bannedAt: Map<string, number>;
}

function pushEdition(m: Map<string, ParsedEdition[]>, key: string, p: ParsedEdition) {
  const list = m.get(key);
  if (list) list.push(p);
  else m.set(key, [p]);
}

function headCandidates(
  editions: ParsedEdition[],
  floor?: EntityHead,
  snapshot?: ParsedEdition[],
  onGap?: () => void,
): ParsedEdition[] {
  const ordered: ParsedEdition[] = [];
  const seenRumors = new Set<string>();
  let gapped = false;

  if (snapshot) {
    const idx = bootstrapHead(editions.map(toFoldEdition), floor?.version ?? 0n);
    if (idx !== null) {
      ordered.push(editions[idx]);
      seenRumors.add(bytesToHex(editions[idx].rumorId));
    } else if (floor !== undefined) {
      gapped = true;
      onGap?.();
    }
  } else {
    const folds: Edition[] = editions.map(toFoldEdition);
    const result = fold(folds, floor?.version ?? 0n, floor?.hash);

    gapped = floor !== undefined && result.gap;
    if (gapped) onGap?.();

    if (result.head !== null && !gapped) {
      ordered.push(editions[result.head]);
      seenRumors.add(bytesToHex(editions[result.head].rumorId));
    }
  }
  const rest = editions
    .filter((e) => {
      const id = bytesToHex(e.rumorId);
      if (seenRumors.has(id)) return false;
      seenRumors.add(id);
      if (gapped && e.version > floor!.version) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.version !== b.version) return a.version > b.version ? -1 : 1;
      return bytesToHex(a.rumorId) < bytesToHex(b.rumorId) ? -1 : 1;
    });
  ordered.push(...rest);
  return ordered;
}

function pickHead(
  candidates: ParsedEdition[],
  heads: Map<string, EntityHead>,
  headEditions: Map<string, ParsedEdition>,
  gate: (p: ParsedEdition) => boolean,
): ParsedEdition | undefined {
  for (const p of candidates) {
    if (!gate(p)) continue;
    heads.set(bytesToHex(p.entityId), { version: p.version, hash: p.selfHash });
    headEditions.set(bytesToHex(p.entityId), p);
    return p;
  }
  return undefined;
}

function byVersionAsc(a: { parsed: ParsedEdition }, b: { parsed: ParsedEdition }): number {
  return a.parsed.version < b.parsed.version ? -1 : a.parsed.version > b.parsed.version ? 1 : 0;
}

function versionGroups<T extends { parsed: ParsedEdition }>(candidates: T[]): T[][] {
  const groups: T[][] = [];
  for (const c of [...candidates].sort(byVersionAsc)) {
    const last = groups[groups.length - 1];
    if (last && last[0].parsed.version === c.parsed.version) last.push(c);
    else groups.push([c]);
  }
  return groups;
}

function authorizeDelegation(
  roleCandidates: Map<string, Array<{ role: Role; author: string; parsed: ParsedEdition }>>,
  grantCandidates: Map<string, Array<{ grant: MemberGrant; author: string; parsed: ParsedEdition }>>,
  ownerHex: string,
  heads: Map<string, EntityHead>,
  headEditions: Map<string, ParsedEdition>,
): CommunityRoles {
  const roster = emptyRoles();
  const settledRoles = new Set<string>();
  const settledGrants = new Set<string>();
  const roleEids = [...roleCandidates.keys()].sort();
  const grantEids = [...grantCandidates.keys()].sort();
  const grantEidOfMember = new Map<string, string>();
  for (const [eid, cands] of grantCandidates) {
    if (cands.length > 0) grantEidOfMember.set(cands[0].grant.member, eid);
  }
  let changed = true;
  let rolesFrozen = false;
  let ranksFrozen = false;

  const settle = (p: ParsedEdition) => {
    heads.set(bytesToHex(p.entityId), { version: p.version, hash: p.selfHash });
    headEditions.set(bytesToHex(p.entityId), p);
  };

  const rankPending = (author: string, selfEid?: string): boolean => {
    if (author === ownerHex) return false;
    const aeid = grantEidOfMember.get(author);
    return aeid !== undefined && aeid !== selfEid && !settledGrants.has(aeid);
  };

  const authorityFirst = (a: { author: string; parsed: ParsedEdition }, b: { author: string; parsed: ParsedEdition }): number => {
    const rank = (author: string) => (author === ownerHex ? -1 : (highestPosition(roster, author) ?? Number.MAX_SAFE_INTEGER));
    const ra = rank(a.author);
    const rb = rank(b.author);
    if (ra !== rb) return ra - rb;
    const ia = bytesToHex(a.parsed.rumorId);
    const ib = bytesToHex(b.parsed.rumorId);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  };

  while (changed) {
    changed = false;

    for (const eid of roleEids) {
      if (settledRoles.has(eid)) continue;
      const candidates = roleCandidates.get(eid)!;
      if (!ranksFrozen && candidates.some((c) => rankPending(c.author))) continue;
      const admissible = new Set<ParsedEdition>();
      let standing: number | undefined;
      for (const group of versionGroups(candidates)) {
        for (const { role, author, parsed } of [...group].sort(authorityFirst)) {
          const mintOk = author === ownerHex || canActOnPosition(roster, author, ownerHex, role.position, Permissions.MANAGE_ROLES);
          const replaceOk = author === ownerHex || standing === undefined || outranks(roster, author, ownerHex, standing);
          if (!mintOk || !replaceOk) continue;
          admissible.add(parsed);
          standing = role.position;
          break;
        }
      }
      const pick = candidates.find((c) => admissible.has(c.parsed));
      if (!pick) continue;
      roster.roles.push(pick.role);
      settledRoles.add(eid);
      settle(pick.parsed);
      changed = true;
    }

    for (const eid of grantEids) {
      if (settledGrants.has(eid)) continue;
      const candidates = grantCandidates.get(eid)!;
      const rolePending = (rid: string) => roleCandidates.has(rid) && !settledRoles.has(rid);
      if (!rolesFrozen && candidates.some((c) => c.grant.roleIds.some(rolePending))) continue;
      if (!ranksFrozen && candidates.some((c) => rankPending(c.author, eid))) continue;

      const admissible = new Set<ParsedEdition>();
      let standing: number | undefined;
      for (const group of versionGroups(candidates)) {
        for (const { grant, author, parsed } of [...group].sort(authorityFirst)) {
          const positions = grant.roleIds
            .map((rid) => roster.roles.find((r) => r.roleId === rid)?.position)
            .filter((p): p is number => p !== undefined);
          const allKnown = positions.length === grant.roleIds.length;
          const ok =
            author === ownerHex ||
            (allKnown &&
              hasPermission(roster, author, Permissions.MANAGE_ROLES) &&
              positions.every((pos) => outranks(roster, author, ownerHex, pos)) &&
              (standing === undefined || outranks(roster, author, ownerHex, standing)));
          if (!ok) continue;
          admissible.add(parsed);
          standing = positions.length ? Math.min(...positions) : undefined;
          break;
        }
      }
      const pick = candidates.find((c) => admissible.has(c.parsed));
      if (!pick) continue;
      roster.grants.push(pick.grant);
      settledGrants.add(eid);
      settle(pick.parsed);
      changed = true;
    }

    if (!changed && !rolesFrozen) {
      rolesFrozen = true;
      changed = true;
    } else if (!changed && !ranksFrozen) {
      ranksFrozen = true;
      changed = true;
    }
  }

  if (roster.roles.length > MAX_ROLES_PER_COMMUNITY) {
    roster.roles.sort((a, b) => (a.roleId < b.roleId ? -1 : a.roleId > b.roleId ? 1 : 0));
    roster.roles = roster.roles.slice(0, MAX_ROLES_PER_COMMUNITY);
  }
  return roster;
}

/**
 * Replay a set of opened control editions into current state.
 */
export function foldControlState(
  editions: ParsedEdition[],
  communityId: Uint8Array,
  ownerHex: string,
  priorHeads?: Map<string, EntityHead>,
  snapshotIds?: Set<string>,
): FoldedControl {
  const result = foldOnce(editions, communityId, ownerHex, priorHeads, snapshotIds);
  const banned = new Set([...result.banned].filter((pk) => pk !== ownerHex));
  if (banned.size > 0 && editions.some((e) => banned.has(e.author))) {
    return {
      ...foldOnce(editions.filter((e) => !banned.has(e.author)), communityId, ownerHex, priorHeads, snapshotIds),
      banned: result.banned,
      bannedAt: result.bannedAt,
      incomplete: result.incomplete,
    };
  }
  return result;
}

function foldOnce(
  editions: ParsedEdition[],
  communityId: Uint8Array,
  ownerHex: string,
  priorHeads?: Map<string, EntityHead>,
  snapshotIds?: Set<string>,
): FoldedControl {
  const cidHex = bytesToHex(communityId);

  const byVsk = new Map<string, Map<string, ParsedEdition[]>>();
  for (const p of editions) {
    let m = byVsk.get(p.vsk);
    if (!m) byVsk.set(p.vsk, (m = new Map()));
    pushEdition(m, bytesToHex(p.entityId), p);
  }

  const heads = new Map<string, EntityHead>();
  const headEditions = new Map<string, ParsedEdition>();
  const gapHeld = new Set<string>();
  const candidatesOf = (vsk: string): Map<string, ParsedEdition[]> => {
    const out = new Map<string, ParsedEdition[]>();
    for (const [eid, list] of byVsk.get(vsk) ?? new Map<string, ParsedEdition[]>()) {
      const snap = snapshotIds ? list.filter((p: ParsedEdition) => snapshotIds.has(bytesToHex(p.rumorId))) : [];
      out.set(
        eid,
        headCandidates(list, priorHeads?.get(eid), snap.length > 0 ? snap : undefined, () => gapHeld.add(eid)),
      );
    }
    return out;
  };

  // Roster
  const roleCandidates = new Map<string, Array<{ role: Role; author: string; parsed: ParsedEdition }>>();
  for (const [eid, candidates] of candidatesOf(VSK_ROLE)) {
    const parsed = candidates
      .map((p) => ({ role: roleFromJSON(p.content), author: p.author, parsed: p }))
      .filter((c): c is { role: Role; author: string; parsed: ParsedEdition } =>
        Boolean(c.role && bytesToHex(hex32(c.role.roleId)) === eid),
      );
    if (parsed.length > 0) roleCandidates.set(eid, parsed);
  }
  const grantCandidates = new Map<string, Array<{ grant: MemberGrant; author: string; parsed: ParsedEdition }>>();
  for (const [eid, candidates] of candidatesOf(VSK_GRANT)) {
    const parsed = candidates
      .map((p) => ({ grant: grantFromJSON(p.content), author: p.author, parsed: p }))
      .filter((c): c is { grant: MemberGrant; author: string; parsed: ParsedEdition } =>
        Boolean(c.grant && bytesToHex(grantLocator(communityId, hex32(c.grant.member))) === eid),
      );
    if (parsed.length > 0) grantCandidates.set(eid, parsed);
  }
  const roster = authorizeDelegation(roleCandidates, grantCandidates, ownerHex, heads, headEditions);

  const grantEditionIndex = new Map<string, Map<string, Set<string>>>();
  for (const [eid, cands] of grantCandidates) {
    const byVer = new Map<string, Set<string>>();
    for (const c of cands) {
      const v = c.parsed.version.toString();
      let s = byVer.get(v);
      if (!s) byVer.set(v, (s = new Set()));
      s.add(bytesToHex(c.parsed.selfHash));
    }
    grantEditionIndex.set(eid, byVer);
  }
  const citationOk = (p: ParsedEdition): boolean => {
    if (p.author === ownerHex) return true;
    const vac = p.authority;
    if (!vac) return false;
    const expectedEid = bytesToHex(grantLocator(communityId, hex32(p.author)));
    if (bytesToHex(vac.entityId) !== expectedEid) return false;
    const hashes = grantEditionIndex.get(expectedEid)?.get(vac.version.toString());
    return hashes !== undefined && hashes.has(bytesToHex(vac.editionHash));
  };

  // Metadata
  let metadata: CommunityMetadata | undefined;
  {
    const candidates = candidatesOf(VSK_METADATA).get(cidHex) ?? [];
    const head = pickHead(candidates, heads, headEditions, (p) => {
      if (!isAuthorized(roster, p.author, ownerHex, Permissions.MANAGE_METADATA)) return false;
      if (!citationOk(p)) return false;
      try {
        const parsed = JSON.parse(p.content) as CommunityMetadata;
        if (typeof parsed.name !== "string" || utf8Len(parsed.name) > NAME_MAX_BYTES) return false;
        if (parsed.description !== undefined && (typeof parsed.description !== "string" || utf8Len(parsed.description) > DESCRIPTION_MAX_BYTES)) return false;
        return true;
      } catch {
        return false;
      }
    });
    if (head) {
      const parsed = JSON.parse(head.content) as CommunityMetadata;
      metadata = {
        ...parsed,
        relays: capRelays(Array.isArray(parsed.relays) ? parsed.relays : []),
        icon: isImagePointer(parsed.icon) ? parsed.icon : undefined,
        banner: isImagePointer(parsed.banner) ? parsed.banner : undefined,
      };
    }
  }

  // Channels
  const channels = new Map<string, FoldedChannel>();
  for (const [eid, candidates] of candidatesOf(VSK_CHANNEL)) {
    const head = pickHead(candidates, heads, headEditions, (p) => {
      if (!isAuthorized(roster, p.author, ownerHex, Permissions.MANAGE_CHANNELS)) return false;
      if (!citationOk(p)) return false;
      try {
        const meta = JSON.parse(p.content) as ChannelMetadata;
        return typeof meta.name === "string" && meta.name.length > 0 && utf8Len(meta.name) <= NAME_MAX_BYTES;
      } catch {
        return false;
      }
    });
    if (!head) continue;
    const meta = normalizeChannelMetadataSimple(JSON.parse(head.content) as ChannelMetadata);
    channels.set(eid, {
      channelIdHex: eid,
      name: meta.name,
      isPrivate: meta.private === true,
      deleted: meta.deleted === true,
      metadata: meta,
    });
  }

  // Banlist
  const banned = new Set<string>();
  const bannedAt = new Map<string, number>();
  {
    const eid = bytesToHex(banlistLocator(communityId));
    const candidates = candidatesOf(VSK_BANLIST).get(eid) ?? [];
    const banlistGate = (p: ParsedEdition): boolean => {
      if (!isAuthorized(roster, p.author, ownerHex, Permissions.BAN)) return false;
      if (!citationOk(p)) return false;
      try {
        return Array.isArray(JSON.parse(p.content));
      } catch {
        return false;
      }
    };
    const head = pickHead(candidates, heads, headEditions, banlistGate);
    if (head) {
      for (const pk of JSON.parse(head.content) as unknown[]) {
        if (typeof pk === "string" && /^[0-9a-f]{64}$/i.test(pk)) banned.add(pk.toLowerCase());
      }
    }
    for (const p of candidates) {
      if (!banlistGate(p)) continue;
      let list: unknown;
      try {
        list = JSON.parse(p.content);
      } catch {
        continue;
      }
      if (!Array.isArray(list)) continue;
      for (const pk of list) {
        if (typeof pk !== "string" || !/^[0-9a-f]{64}$/i.test(pk)) continue;
        const k = pk.toLowerCase();
        if (k === ownerHex) continue;
        const prev = bannedAt.get(k);
        if (prev === undefined || p.createdAt > prev) bannedAt.set(k, p.createdAt);
      }
    }
  }

  // Invite registries
  const liveInviteLinks = new Set<string>();
  const registriesByCreator = new Map<string, string[]>();
  for (const [eid, candidates] of candidatesOf(VSK_INVITE_REGISTRY)) {
    const head = pickHead(candidates, heads, headEditions, (p) => {
      if (bytesToHex(inviteLinksLocator(communityId, hex32(p.author))) !== eid) return false;
      if (!isAuthorized(roster, p.author, ownerHex, Permissions.CREATE_INVITE)) return false;
      if (!citationOk(p)) return false;
      try {
        return Array.isArray(JSON.parse(p.content));
      } catch {
        return false;
      }
    });
    if (!head) continue;
    const list = (JSON.parse(head.content) as unknown[]).filter(
      (s): s is string => typeof s === "string" && /^[0-9a-f]{64}$/i.test(s),
    );
    registriesByCreator.set(head.author, list);
    for (const pk of list) liveInviteLinks.add(pk.toLowerCase());
  }

  const servedEids = new Set<string>();
  for (const m of byVsk.values()) for (const eid of m.keys()) servedEids.add(eid);
  const incomplete = [...gapHeld];
  for (const eid of priorHeads?.keys() ?? []) {
    if (!servedEids.has(eid) && !gapHeld.has(eid)) incomplete.push(eid);
  }

  return { roster, ownerHex, metadata, channels, banned, bannedAt, liveInviteLinks, registriesByCreator, heads, headEditions, incomplete };
}

/** Simplified channel metadata normalization (no Git extensions). */
function normalizeChannelMetadataSimple(metadata: ChannelMetadata): ChannelMetadata {
  return { ...metadata };
}

// ── Dissolution (CORD-02 §9) ─────────────────────────────────────────────────

const ZERO32_HEX = "0".repeat(64);

export function buildDissolvedRumor(ownerPubkey: string, createdAtSecs?: number): Rumor {
  return buildRumor({
    kind: 3308,
    content: "",
    tags: [
      ["vsk", VSK_DISSOLVED],
      ["eid", ZERO32_HEX],
    ],
    pubkey: ownerPubkey,
    ms: null,
    createdAtSecs,
  });
}

export async function sealDissolved(communityId: Uint8Array, ownerPubkey: string, signer: StreamSigner): Promise<NostrEvent> {
  const group = dissolvedGroupKey(communityId);
  const rumor = buildDissolvedRumor(ownerPubkey);
  const seal = await sealRumor(rumor, KIND_SEAL_PLAINTEXT, group, signer);
  return wrapSeal(seal, group);
}

export function isDissolved(wraps: NostrEvent[], communityId: Uint8Array, ownerHex: string): boolean {
  const group = dissolvedGroupKey(communityId);
  for (const wrap of wraps) {
    let opened: OpenedEvent;
    try {
      opened = openWrap(wrap, group);
    } catch {
      continue;
    }
    if (isDissolvedOpened(opened, ownerHex)) return true;
  }
  return false;
}

export function isDissolvedOpened(opened: OpenedEvent, ownerHex: string): boolean {
  if (opened.author !== ownerHex) return false;
  if (opened.sealKind !== KIND_SEAL_PLAINTEXT) return false;
  const vsk = opened.tags.find((t) => t[0] === "vsk")?.[1];
  const eid = opened.tags.find((t) => t[0] === "eid")?.[1];
  return opened.kind === 3308 && vsk === VSK_DISSOLVED && eid === ZERO32_HEX;
}
