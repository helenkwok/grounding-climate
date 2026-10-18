# Capability-aware WebMCP surface

Issue: #7

Grounding exposes application capabilities to browser agents through a small, dynamically selected WebMCP surface.

The architectural rule is:

```text
WebMCP adapter
→ gated application command
→ module/provider service
→ domain / verification / crypto
```

WebMCP is not the domain layer and does not implement signing, evidence roots, model inference, or chain calls itself.

## Current browser API

Grounding targets:

```ts
document.modelContext
```

There is intentionally no `navigator.modelContext` fallback. Existing Chisel work already confirmed that spelling is obsolete for the current API shape.

If `document.modelContext` is unavailable, the application remains usable. `registerClimateWebMcp()` returns a fallback executor that uses the **same gated handlers** without registering browser-agent tools.

## Capability registry

Each analysis module declares:

- module ID/title
- capabilities
- tools
- required capability for each tool

Examples:

```text
building
  building-meter-mrv
  carbon-recalculation

energy
  renewable-forecasting

earth
  earth-observation

battery
  battery-dpp

carbon
  carbon-registry
```

The registry rejects duplicate module IDs and duplicate tool names.

A case advertises its active capabilities. Only tools whose required capabilities are present are selected for the active WebMCP surface.

This prevents every case from exposing every possible tool and keeps the model tool budget bounded.

## Core tools

The always-on core is deliberately small:

- `climate_list_capabilities`
- `climate_get_case`
- `climate_list_sources`
- `climate_get_claim`
- `climate_get_evidence`
- `climate_get_provenance`
- `climate_compare_claims`
- `climate_list_checks`

These invoke the shared evidence/case workspace.

## Dynamic module catalogue

The common module catalogue includes the issue-planned tools for:

- Building MRV
- Renewable Energy
- Earth Observation
- Battery DPP
- Carbon Registry
- Public Disclosure

`createRoutedModule()` binds these tool definitions to a normal application `ModuleCommandRouter`. The router is where #9–#13 implementations plug in.

The tests register building, energy, Earth, battery, and carbon modules simultaneously and verify their tools coexist without collisions.

## Trust tools

Trust operations route into the application services built on #18 and #8:

- `climate_create_attestation`
- `climate_verify_attestation`
- `climate_anchor_attestation`
- `climate_publish_bundle`

Creating an attestation, anchoring, or publishing is consequential and therefore human-approved.

Verification is read-only.

`climate_anchor_attestation` is only selected when the active case advertises the `anchoring` capability. The domain/crypto layers still decide what can actually be anchored.

## Single consequential gate

Every tool handler passes through one gate before it can become a WebMCP `execute` function.

Consequential operations:

1. emit an activity event
2. show the human the tool name and meaningful arguments
3. enter a serialized approval queue
4. execute only after approval
5. return an explicit refusal when declined

The handler is never run and then rolled back.

Serialized approval matters because two simultaneous consequential calls must not create stacked consent dialogs where one click could be mistaken for consent to both.

## Activity trail

`ActivityLog` captures:

- called
- approved
- declined
- ok
- error

including arguments for the initial call and error detail where relevant.

The package is UI-neutral; a future app can render this log in a panel without changing the gate.

## Untrusted content

Every WebMCP registration sets:

```ts
untrustedContentHint: true
```

because climate evidence may contain externally supplied text such as:

- reports
- company disclosures
- registry fields
- supplier declarations
- dataset metadata

This annotation is advisory, not a security boundary. Consequential operations still go through the human gate.

## Output bounds

Text/JSON output is capped before being returned to the agent.

Truncation is explicitly announced as **INCOMPLETE**, and the truncation sentinel is neutralized in source content so external data cannot forge the system truncation notice.

The correct response to truncation is to issue a narrower query rather than infer from partial evidence.

## Dynamic registration

WebMCP has no ordinary unregister call in the current pattern.

`DynamicClimateWebMcp.activate()` therefore:

```text
abort previous registration signal
→ resolve active case capabilities
→ select tools
→ register a fresh surface with a new AbortController
```

This means changing cases can add/remove module tools without accumulating stale tools.

## Non-WebMCP fallback

The same gated execution map is always retained.

When WebMCP is unavailable:

```text
surface.available === false
surface.executeFallback(...)
```

still invokes the same approval, activity, output-cap, and application-command path.

There is no separate unsafe fallback handler.

## Multi-app composition

If Grounding later becomes a shell containing multiple same-origin apps, use the Chisel pattern:

```text
top-level shell
→ owns document.modelContext
→ receives plain tool catalogues from same-origin child apps
→ forwards invocation to the child's already-gated execute
```

The security invariant is the important part: the bridge forwards into the same gated handler; it never exports or reconstructs an ungated domain operation.

A separate transport abstraction can be added when the shell actually exists. The current package deliberately does not invent cross-frame complexity before the deployment requires it.

## Current boundary with #9–#13

#7 supplies the common plumbing. The analytical modules remain responsible for:

- real upstream data
- benchmark/baseline
- metric/check
- named decision/user
- provenance output
- deterministic failure/tamper case

They register their commands behind the module router. They do not carry their own WebMCP safety or crypto implementation.
