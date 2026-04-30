# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x     | Best effort (experimental) |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public GitHub issue**
2. File a [GitHub Private Security Advisory](https://github.com/SgtPooki/wtfoc/security/advisories/new) — this keeps the report private until a fix is ready and gives us a structured workflow for coordinated disclosure
3. Include: description, reproduction steps, impact assessment
4. We aim to respond within 72 hours

## Security Considerations

### Immutable storage warning

Data stored on FOC (Filecoin Onchain Cloud) or IPFS is **permanent and public**. Once uploaded:
- It cannot be deleted or modified
- Anyone with the CID can retrieve it
- Content is cryptographically verifiable

**Always redact sensitive data before ingesting.** Source adapters should strip tokens, credentials, and PII before chunking.

### Wallet keys

- Never commit wallet private keys to the repository
- Use environment variables (`WTFOC_PRIVATE_KEY`) or external key management
- The `--local` storage mode requires no wallet

### Fixtures and test data

- All test fixtures must be synthetic — no real Slack exports, customer data, or private repo content
- The golden demo dataset uses fabricated data with realistic structure
