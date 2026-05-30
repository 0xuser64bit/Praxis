/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/aegis.json`.
 */
export type Aegis = {
  "address": "7qRKV1dNPCixKWDLHsuHa5puFsNPtNCzC1sX6P1kpFgb",
  "metadata": {
    "name": "aegis",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "agentTransfer",
      "docs": [
        "Agent-initiated. Enforces the full policy (see `agent_transfer`)."
      ],
      "discriminator": [
        199,
        111,
        151,
        49,
        124,
        13,
        150,
        44
      ],
      "accounts": [
        {
          "name": "agentAuthority",
          "docs": [
            "The agent's scoped session key. Must equal `policy.agent_authority`."
          ],
          "signer": true
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "policy.owner",
                "account": "policyAccount"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "policy"
              }
            ]
          }
        },
        {
          "name": "recipient",
          "docs": [
            "handler (check 6) and only ever credited lamports, never read."
          ],
          "writable": true
        },
        {
          "name": "actionLog",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  108,
                  111,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "policy"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "agentTransferSpl",
      "docs": [
        "Agent-initiated SPL-token transfer. Enforces the dedicated token envelope",
        "+ the on-chain mint allow-list (see `agent_transfer_spl`)."
      ],
      "discriminator": [
        248,
        212,
        16,
        124,
        45,
        7,
        217,
        100
      ],
      "accounts": [
        {
          "name": "agentAuthority",
          "signer": true
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "policy.owner",
                "account": "policyAccount"
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "The vault PDA — the AUTHORITY over the vault's token account. Signs the",
            "token CPI via seeds; never read as data."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "policy"
              }
            ]
          }
        },
        {
          "name": "vaultTokenAccount",
          "docs": [
            "account owned by the SPL Token program, with `mint == policy.token_mint`",
            "and `authority == vault`."
          ],
          "writable": true
        },
        {
          "name": "recipientTokenAccount",
          "docs": [
            "account owned by the SPL Token program with `mint == policy.token_mint`."
          ],
          "writable": true
        },
        {
          "name": "actionLog",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  108,
                  111,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "policy"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "configureToken",
      "docs": [
        "Owner-only. Configure the single SPL-token envelope (mint + token caps)."
      ],
      "discriminator": [
        237,
        33,
        22,
        68,
        66,
        204,
        255,
        70
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "tokenMint",
          "type": "pubkey"
        },
        {
          "name": "tokenMaxPerTx",
          "type": "u64"
        },
        {
          "name": "tokenDailyLimit",
          "type": "u64"
        }
      ]
    },
    {
      "name": "fundVault",
      "docs": [
        "Owner-only. Fund the program-owned SOL vault."
      ],
      "discriminator": [
        26,
        33,
        207,
        242,
        119,
        108,
        134,
        73
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "vault",
          "docs": [
            "The program-governed SOL vault, seeded by the policy."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "policy"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializePolicy",
      "docs": [
        "Owner creates the policy + audit log and registers the agent key."
      ],
      "discriminator": [
        9,
        186,
        86,
        225,
        129,
        162,
        231,
        56
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "actionLog",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  99,
                  116,
                  105,
                  111,
                  110,
                  95,
                  108,
                  111,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "policy"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "agentAuthority",
          "type": "pubkey"
        },
        {
          "name": "maxPerTx",
          "type": "u64"
        },
        {
          "name": "dailyLimit",
          "type": "u64"
        },
        {
          "name": "allowedPrograms",
          "type": {
            "vec": "pubkey"
          }
        },
        {
          "name": "allowedRecipients",
          "type": {
            "vec": "pubkey"
          }
        },
        {
          "name": "allowedMints",
          "type": {
            "vec": "pubkey"
          }
        },
        {
          "name": "expiryTs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "revokeAgent",
      "docs": [
        "Owner-only kill switch. Zeroes the agent key and pauses."
      ],
      "discriminator": [
        227,
        60,
        209,
        125,
        240,
        117,
        163,
        73
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "rotateAgent",
      "docs": [
        "Owner-only. Swap in a fresh agent session key (and unpause)."
      ],
      "discriminator": [
        182,
        91,
        147,
        107,
        155,
        47,
        150,
        176
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "newAgentAuthority",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "updatePolicy",
      "docs": [
        "Owner-only. Adjust caps, allow-lists, expiry, paused."
      ],
      "discriminator": [
        212,
        245,
        246,
        7,
        163,
        151,
        18,
        57
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "maxPerTx",
          "type": "u64"
        },
        {
          "name": "dailyLimit",
          "type": "u64"
        },
        {
          "name": "allowedPrograms",
          "type": {
            "vec": "pubkey"
          }
        },
        {
          "name": "allowedRecipients",
          "type": {
            "vec": "pubkey"
          }
        },
        {
          "name": "allowedMints",
          "type": {
            "vec": "pubkey"
          }
        },
        {
          "name": "expiryTs",
          "type": "i64"
        },
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "withdrawVault",
      "docs": [
        "Owner-only and UNCONSTRAINED by policy — it's the owner's money."
      ],
      "discriminator": [
        135,
        7,
        237,
        120,
        149,
        94,
        95,
        7
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "policy"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "actionLog",
      "discriminator": [
        21,
        124,
        15,
        134,
        245,
        104,
        185,
        20
      ]
    },
    {
      "name": "policyAccount",
      "discriminator": [
        218,
        201,
        183,
        164,
        156,
        127,
        81,
        175
      ]
    }
  ],
  "events": [
    {
      "name": "agentActionAllowed",
      "discriminator": [
        50,
        14,
        56,
        226,
        144,
        74,
        44,
        0
      ]
    },
    {
      "name": "agentActionRejected",
      "discriminator": [
        110,
        215,
        49,
        117,
        199,
        132,
        209,
        46
      ]
    },
    {
      "name": "agentRevoked",
      "discriminator": [
        12,
        251,
        249,
        166,
        122,
        83,
        162,
        116
      ]
    },
    {
      "name": "agentRotated",
      "discriminator": [
        128,
        98,
        178,
        231,
        254,
        100,
        152,
        242
      ]
    },
    {
      "name": "policyInitialized",
      "discriminator": [
        102,
        184,
        59,
        178,
        235,
        69,
        251,
        181
      ]
    },
    {
      "name": "policyUpdated",
      "discriminator": [
        225,
        112,
        112,
        67,
        95,
        236,
        245,
        161
      ]
    },
    {
      "name": "tokenConfigured",
      "discriminator": [
        153,
        220,
        126,
        193,
        90,
        98,
        145,
        116
      ]
    },
    {
      "name": "vaultFunded",
      "discriminator": [
        192,
        119,
        245,
        193,
        55,
        223,
        195,
        50
      ]
    },
    {
      "name": "vaultWithdrawn",
      "discriminator": [
        238,
        9,
        219,
        172,
        188,
        77,
        72,
        104
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorizedAgent",
      "msg": "Signer is not the registered agent authority"
    },
    {
      "code": 6001,
      "name": "policyPaused",
      "msg": "Policy is paused (or the agent has been revoked)"
    },
    {
      "code": 6002,
      "name": "sessionExpired",
      "msg": "Agent session key has expired"
    },
    {
      "code": 6003,
      "name": "exceedsPerTxLimit",
      "msg": "Amount exceeds the per-transaction limit"
    },
    {
      "code": 6004,
      "name": "exceedsDailyLimit",
      "msg": "Amount exceeds the remaining daily limit"
    },
    {
      "code": 6005,
      "name": "recipientNotAllowed",
      "msg": "Recipient is not in the allow-list"
    },
    {
      "code": 6006,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6007,
      "name": "tooManyPrograms",
      "msg": "Too many allowed programs (exceeds MAX_ALLOWED_PROGRAMS)"
    },
    {
      "code": 6008,
      "name": "tooManyRecipients",
      "msg": "Too many allowed recipients (exceeds MAX_ALLOWED_RECIPIENTS)"
    },
    {
      "code": 6009,
      "name": "tooManyMints",
      "msg": "Too many allowed mints (exceeds MAX_ALLOWED_MINTS)"
    },
    {
      "code": 6010,
      "name": "invalidLimits",
      "msg": "Invalid policy limits (expiry must be in the future)"
    },
    {
      "code": 6011,
      "name": "insufficientVaultBalance",
      "msg": "Vault has insufficient balance for this transfer"
    },
    {
      "code": 6012,
      "name": "invalidAgentAuthority",
      "msg": "Agent authority cannot be the default public key"
    },
    {
      "code": 6013,
      "name": "mintNotAllowed",
      "msg": "Transfer mint is not the policy's configured token mint"
    },
    {
      "code": 6014,
      "name": "splNotConfigured",
      "msg": "SPL token transfers are not configured for this policy"
    },
    {
      "code": 6015,
      "name": "invalidTokenAccount",
      "msg": "Account is not a valid SPL token account for the configured mint"
    }
  ],
  "types": [
    {
      "name": "actionLog",
      "docs": [
        "On-chain audit log: a fixed-capacity ring buffer of `ActionRecord`s, PDA",
        "seeded by `policy`. Powers the \"auditable without trust\" activity feed.",
        "",
        "NOTE: only ALLOWED actions are durably recorded here. A rejected",
        "`agent_transfer` returns `Err`, which reverts ALL account writes — so a",
        "rejected record cannot be persisted in the same failing instruction.",
        "Rejections are surfaced via the typed error + the `AgentActionRejected`",
        "event (visible in the failed transaction's logs). See `agent_transfer`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "head",
            "docs": [
              "Next write index (mod `ACTION_LOG_CAP`)."
            ],
            "type": "u16"
          },
          {
            "name": "count",
            "docs": [
              "Number of valid entries (saturates at `ACTION_LOG_CAP`)."
            ],
            "type": "u16"
          },
          {
            "name": "total",
            "docs": [
              "Monotonic total of allowed actions ever recorded."
            ],
            "type": "u64"
          },
          {
            "name": "entries",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "actionRecord"
                  }
                },
                32
              ]
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "actionRecord",
      "docs": [
        "One audited action. Fixed-size so it lives in the ring buffer below."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "target",
            "type": "pubkey"
          },
          {
            "name": "result",
            "docs": [
              "`RESULT_ALLOWED` / `RESULT_REJECTED`."
            ],
            "type": "u8"
          },
          {
            "name": "reason",
            "docs": [
              "`RejectReason` code; meaningful only when `result == RESULT_REJECTED`."
            ],
            "type": "u8"
          },
          {
            "name": "ts",
            "docs": [
              "Unix seconds."
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "agentActionAllowed",
      "docs": [
        "Emitted on a passing `agent_transfer`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "target",
            "type": "pubkey"
          },
          {
            "name": "spentToday",
            "type": "u64"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "agentActionRejected",
      "docs": [
        "Emitted just before a failing `agent_transfer` returns its typed error.",
        "Lives only in the (failed) transaction's logs — state writes are reverted."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "reason",
            "docs": [
              "`RejectReason` code."
            ],
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "target",
            "type": "pubkey"
          },
          {
            "name": "ts",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "agentRevoked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "agentRotated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "newAgentAuthority",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "policyAccount",
      "docs": [
        "The on-chain spending envelope (spec §5). PDA seeded by `owner`.",
        "",
        "The `owner` key is unconstrained elsewhere (deposit/withdraw/update/revoke);",
        "the `agent_authority` session key may only move funds within this envelope.",
        "`allowed_programs` / `allowed_mints` are stored for the swap phase and are",
        "NOT enforced by `agent_transfer` (transfers are SOL, recipient-gated only)."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "agentAuthority",
            "docs": [
              "The registered scoped signer. Set to `Pubkey::default()` on revoke."
            ],
            "type": "pubkey"
          },
          {
            "name": "maxPerTx",
            "type": "u64"
          },
          {
            "name": "dailyLimit",
            "type": "u64"
          },
          {
            "name": "spentToday",
            "type": "u64"
          },
          {
            "name": "dayStartTs",
            "docs": [
              "Unix seconds; start of the current rolling 24h window."
            ],
            "type": "i64"
          },
          {
            "name": "allowedPrograms",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "allowedRecipients",
            "docs": [
              "Empty == any recipient allowed (spec §5)."
            ],
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "allowedMints",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "expiryTs",
            "docs": [
              "Unix seconds; the session key auto-expires at/after this."
            ],
            "type": "i64"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "tokenMint",
            "docs": [
              "The single SPL mint the agent may move via `agent_transfer_spl`.",
              "`Pubkey::default()` == SPL transfers disabled (not configured). Enforced",
              "on-chain: a token transfer's mint MUST equal this — the on-chain mint",
              "allow-list, single-mint form. Set via `configure_token` (owner-only)."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenMaxPerTx",
            "docs": [
              "Per-tx cap in the token's own base units."
            ],
            "type": "u64"
          },
          {
            "name": "tokenDailyLimit",
            "docs": [
              "Rolling daily cap in the token's own base units."
            ],
            "type": "u64"
          },
          {
            "name": "tokenSpentToday",
            "type": "u64"
          },
          {
            "name": "tokenDayStartTs",
            "docs": [
              "Unix seconds; start of the current rolling 24h window for the token."
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "policyInitialized",
      "docs": [
        "Emitted by `initialize_policy`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "agentAuthority",
            "type": "pubkey"
          },
          {
            "name": "maxPerTx",
            "type": "u64"
          },
          {
            "name": "dailyLimit",
            "type": "u64"
          },
          {
            "name": "expiryTs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "policyUpdated",
      "docs": [
        "Emitted by `update_policy`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "maxPerTx",
            "type": "u64"
          },
          {
            "name": "dailyLimit",
            "type": "u64"
          },
          {
            "name": "expiryTs",
            "type": "i64"
          },
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "tokenConfigured",
      "docs": [
        "Emitted by `configure_token` when the owner sets the SPL-token envelope."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "tokenMint",
            "type": "pubkey"
          },
          {
            "name": "tokenMaxPerTx",
            "type": "u64"
          },
          {
            "name": "tokenDailyLimit",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "vaultFunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "newBalance",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "vaultWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "policy",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "newBalance",
            "type": "u64"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "seedActionLog",
      "type": "bytes",
      "value": "[97, 99, 116, 105, 111, 110, 95, 108, 111, 103]"
    },
    {
      "name": "seedPolicy",
      "docs": [
        "PDA seeds. Kept in lockstep with `@praxis/shared` (shared/src/constants.ts)."
      ],
      "type": "bytes",
      "value": "[112, 111, 108, 105, 99, 121]"
    },
    {
      "name": "seedVault",
      "type": "bytes",
      "value": "[118, 97, 117, 108, 116]"
    }
  ]
};
