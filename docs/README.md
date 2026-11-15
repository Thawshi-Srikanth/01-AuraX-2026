# AURAx documentation

[Project home](../README.md)

## Use the application

- [Sky map guide](sky-map-guide.md): projections, layers, reference regions, and opening coordinates.
- [Images guide](images-guide.md): filters, cutouts, metadata tabs, playback, saving, and failures.
- [Screenshot walkthrough](user-guide.md): target entry, a real comparison, quality checks, and common failures.
- [Interactive guide](https://aurax.thawshi.com/docs): seven chapters on observations, optics, coordinates, brightness, wavelengths, comparison, and archive access.
- [Scientific limits](scientific-limits.md): what the displayed images and spectral samples do and do not establish.
- [Checked Epsilon Indi B example](epsilon-indi-example-validation-2026-11-15.md): original observations, diagnostics, figure, animation, and reproduction.
- [Challenge audit](challenge-audit-2026-11-15.md): five-target validation and remaining limitations.

## Build and maintain

- [Development](development.md): prerequisites, native setup, manual servers, checks, and troubleshooting.
- [Contributing](../CONTRIBUTING.md): issue reports, branches, pull requests, and review expectations.
- [Architecture](architecture.md): components, request flow, and repository layout.
- [API reference](api-reference.md): endpoint examples and response constraints.
- [Data pipeline](data-pipeline.md): calibrated FITS parsing, caching, quotas, and background cache jobs.
- [Releases and versions](releases.md): numbered tags, server updates, and publishing the next version.
- [Deployment](deployment.md): production images, HTTPS, updates, rollback, and project-name conflicts.

## Context and attribution

- [Behind the project](project-story.md)
- [AI assistance disclosure](ai-disclosure.md)
- [Data, images, and software credits](credits.md)
- [Screenshot provenance](images/README.md)

## Recorded evidence versus current behavior

Dated validation reports record what was tested at that time; they do not certify every future archive request or identify every source. JSON reports next to the audits preserve diagnostics. The [progress log](PROGRESS.md) and [backlog](BACKLOG.md) are development history, not the starting point for users. The API's runtime schema is available at `/backend/docs` on a deployment or `http://127.0.0.1:8000/docs` during manual development.
