# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability within this project, please report it
by emailing **sacrtap@github.com**.

Please **do not** create a public GitHub issue for security vulnerabilities.

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 1 week
- **Fix Release**: Depends on severity, typically within 2-4 weeks

## Security Best Practices

When using this 3DGS rendering framework:

1. **COOP/COEP Headers**: Configure Cross-Origin-Opener-Policy and
   Cross-Origin-Embedder-Policy headers on your server to enable
   SharedArrayBuffer for optimal performance.

2. **Data Validation**: Validate all 3DGS data files (PLY, SPLAT, SPZ, SOG)
   before loading from untrusted sources.

3. **CSP**: Configure Content-Security-Policy headers appropriately for
   your deployment environment.
