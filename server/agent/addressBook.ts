import { PublicKey } from "@solana/web3.js";
import type { AddressBookEntry, ClarifyOption } from "@praxis/shared";

export type ResolveRecipientResult =
  | { kind: "exact"; entry: AddressBookEntry }
  | { kind: "ambiguous"; question: string; options: ClarifyOption[] }
  | { kind: "missing"; question: string; options: ClarifyOption[] };

export class AddressBook {
  private entries: AddressBookEntry[];

  constructor(entries: AddressBookEntry[]) {
    this.entries = [...entries];
  }

  /** Upsert a contact, deduping by address and label (newest wins, placed first). */
  add(entry: AddressBookEntry): void {
    this.entries = [
      entry,
      ...this.entries.filter((e) => e.address !== entry.address && e.label !== entry.label),
    ];
  }

  all(): AddressBookEntry[] {
    return this.entries;
  }

  labelFor(address: string): string {
    const found = this.entries.find((entry) => entry.address === address);
    return found?.name ?? "Unlabeled recipient";
  }

  resolve(input: string): ResolveRecipientResult {
    const raw = input.trim().replace(/[.?!]+$/, "");
    const normalized = normalize(raw);
    const directAddress = parseAddress(raw);
    if (directAddress) {
      const base58 = directAddress.toBase58();
      const known = this.entries.find((entry) => entry.address === base58);
      if (known) return { kind: "exact", entry: known };
      return {
        kind: "exact",
        entry: {
          label: "pasted-address",
          name: "Pasted address",
          address: base58,
          note: "not saved in the address book",
        },
      };
    }

    const matches = this.entries.filter((entry) => {
      return normalize(entry.label) === normalized || normalize(entry.name) === normalized;
    });

    if (matches.length === 1) return { kind: "exact", entry: matches[0] };

    if (matches.length > 1) {
      return {
        kind: "ambiguous",
        question: `I have more than one saved contact for "${raw}". Which one did you mean?`,
        options: matches.map(toOption),
      };
    }

    const fuzzy = fuzzyMatches(normalized, this.entries);
    if (fuzzy.length > 0) {
      return {
        kind: "ambiguous",
        question: `I found possible saved contacts for "${raw}". Which one did you mean?`,
        options: fuzzy.map(toOption),
      };
    }

    return {
      kind: "missing",
      question: `I do not have "${raw}" saved. Paste the address or add it to the address book first.`,
      options: uniqueByAddress(this.entries).slice(0, 6).map(toOption),
    };
  }
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function fuzzyMatches(input: string, entries: AddressBookEntry[]): AddressBookEntry[] {
  if (input.length < 2) return [];

  const scored: Array<{ entry: AddressBookEntry; score: number }> = [];
  for (const entry of uniqueByAddress(entries)) {
    const candidates = [entry.label, entry.name, ...entry.name.split(/\s+/)].map(normalize);
    let best = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (candidate.includes(input) || input.includes(candidate)) {
        best = Math.min(best, 0);
        continue;
      }
      best = Math.min(best, editDistance(input, candidate));
    }

    const maxDistance = input.length <= 5 ? 1 : 2;
    if (best <= maxDistance) scored.push({ entry, score: best });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name))
    .slice(0, 6)
    .map((item) => item.entry);
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    prev.splice(0, prev.length, ...curr);
  }

  return prev[b.length];
}

function parseAddress(value: string): PublicKey | undefined {
  try {
    return new PublicKey(value);
  } catch {
    return undefined;
  }
}

function toOption(entry: AddressBookEntry): ClarifyOption {
  return {
    label: entry.name,
    value: entry.label,
    hint: entry.note ?? entry.address,
  };
}

function uniqueByAddress(entries: AddressBookEntry[]): AddressBookEntry[] {
  const seen = new Set<string>();
  const out: AddressBookEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.address)) continue;
    seen.add(entry.address);
    out.push(entry);
  }
  return out;
}
