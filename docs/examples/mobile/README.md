# Mobile Branding Examples

These files define the contract for self-distributed CrewCmd mobile builds.

- `org.mobile.example.json`: example white-label branding manifest for a single organization.
- `org.mobile.schema.json`: JSON schema for branding manifests.
- `bootstrap-payload.example.json`: example first-run bootstrap payload that can be encoded into a QR code or deep link.
- `branding/`: placeholder icon and splash assets that make the example manifest validate out of the box.

Validate a manifest:

```bash
pnpm mobile:validate-branding docs/examples/mobile/org.mobile.example.json
```

Generate a bootstrap deep link from a payload file:

```bash
pnpm mobile:bootstrap-url docs/examples/mobile/bootstrap-payload.example.json
```
