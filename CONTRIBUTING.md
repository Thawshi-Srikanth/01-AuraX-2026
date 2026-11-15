# Contributing to AURAx

[Project home](README.md) · [Documentation](docs/README.md)

Contributions should improve access to real SPHEREx observations, useful comparison, understandable controls, or trustworthy interpretation. Read the [scientific limits](docs/scientific-limits.md) before changing data handling.

## Report a problem

Use [GitHub Issues](https://github.com/Thawshi-Srikanth/01-AuraX-2026/issues). Include:

- The page and action that failed, with expected and actual behavior.
- Browser/device and whether the app is local or deployed.
- Coordinates, observation IDs, dates, detector filters, and field size when relevant.
- A screenshot and the visible error. Remove credentials and private information.
- Whether a retry succeeded. A service timeout is different from an empty search.

For a scientific interpretation concern, include original product references and masks rather than relying on display colors.

## Make a change

1. Follow [development setup](docs/development.md).
2. Create a descriptive branch, for example `docs/user-guide` or `fix/image-selection`.
3. Keep the change focused. Discuss substantial scientific or optional-feature additions in an issue first.
4. Run relevant [checks](docs/development.md#checks-before-a-pull-request).
5. Update the linked documentation and screenshots if behavior changed.
6. Open a pull request explaining the problem, resulting behavior, validation, and remaining limits.

Do not mix dependency upgrades, unrelated formatting, or generated caches into a focused change.

## Scientific review expectations

Preserve native units, WCS/SIP behavior, FITS identities, flags, uncertainties, provenance, and bounded requests. Do not fill masked observations with invented data. Keep general multiwavelength playback distinct from checked time blink. A catalog marker is not a confirmed image detection; a displacement diagnostic is not a discovery certificate.

Changes affecting calibration, masks, wavelength matching, source association, or measurements need meaningful regression evidence. State which checks use mocks, cached real data, or live requests. Do not claim archive-wide completeness from a bounded query.

## Documentation and screenshots

Use relative links inside the repository and descriptive alt text. Capture real app screens, record the source URL/date and state, and explain any error shown. Label schematics and historical validation figures. Do not alter a scientific screenshot to imply a successful result. See [screenshot provenance](docs/images/README.md).

## AI assistance and external materials

Codex and Gemini were used for project coding; [our disclosure](docs/ai-disclosure.md) explains that assistance. Disclose material AI assistance in your contribution. Review generated code and text, verify sources, and retain external credits. Apply any event-required labels to generated media.

Do not submit third-party assets without their source, credit, and reuse terms. This repository does not currently contain a project-wide LICENSE file; do not assume that all project code or external imagery has the same license.
