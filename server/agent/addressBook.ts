import { PublicKey } from "@solana/web3.js";
import type { AddressBookEntry, ClarifyOption } from "@praxis/shared";

export type ResolveRecipientResult =
  | { kind: "exact"; entry: AddressBookEntry }
  | { kind: "ambiguous"; question: string; options: ClarifyOption[] }
  | { kind: "missing"; question: string; options: ClarifyOption[] };

export class AddressBook {
  constructor(private readonly entries: AddressBookEntry[]) {}

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
      return {
        kind: "exact",
        entry: {
          label: "pasted-address",
          name: "Pasted address",
          address: directAddress.toBase58(),
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
