# Data, image, and software credits

[Documentation](README.md) · [AI disclosure](ai-disclosure.md)

## Scientific observations and catalog references

- [NASA/IPAC IRSA SPHEREx archive](https://irsa.ipac.caltech.edu/Missions/spherex.html): observation metadata and calibrated FITS products.
- [Official SPHEREx cutout tutorial](https://caltech-ipac.github.io/irsa-tutorials/spherex-cutouts/): plane/artifact query and calibrated-cutout guidance, including SIA access context.
- [SPHEREx archive documentation](https://caltech-ipac.github.io/spherex-archive-documentation/): products, calibration, and access.
- [IRSA TAP documentation](https://irsa.ipac.caltech.edu/docs/program_interface/TAP.html).
- [CDS SIMBAD](https://simbad.cds.unistra.fr/simbad/): named targets, catalog coordinates, proper motions, object types, and reference records.

SPHEREx is a joint JPL/Caltech project funded by NASA. Follow the current [IRSA acknowledgement guidance](https://irsa.ipac.caltech.edu/Missions/spherex.html) when publishing work using these products. Catalog references and approximate propagated positions are not independently verified detections.

## Images and figures

- [Home image credits and original sources](../frontend/public/assets/home/CREDITS.md): NASA/JPL-Caltech SPHEREx all-sky cover, previous Vela cover, and spacecraft concept.
- [NOIRLab 88 Constellations](https://noirlab.edu/public/education/constellations/): photographic sky-navigation background, attributed in source comments to Eckhard Slawik's all-sky material. The exact downloaded derivative and full image credit should be checked against the original asset record before republication.
- [Documentation screenshot manifest](images/README.md): direct captures, source URLs, dates, and visible states.
- [Epsilon Indi B figures](epsilon-indi-example-validation-2026-11-15.md): processing and display of identified real SPHEREx observations.
- Older educational schematics and analogy images in `frontend/public/assets/docs/` are explanatory material. Their complete creation/source history still needs an asset-by-asset record; no blanket rights or AI-origin claim is made here.

NASA mission imagery, navigation photography, conceptual illustrations, and measured observation frames serve different purposes. A navigation background or cover is not the selected science exposure.

## Main software

| Purpose | Tools |
| --- | --- |
| Astronomy and numerical processing | [Astropy](https://www.astropy.org/), [NumPy](https://numpy.org/), [Photutils](https://photutils.readthedocs.io/), [Reproject](https://reproject.readthedocs.io/), [PyVO](https://pyvo.readthedocs.io/) |
| Backend | [Python](https://www.python.org/), [FastAPI](https://fastapi.tiangolo.com/), [Uvicorn](https://www.uvicorn.org/), [Requests](https://requests.readthedocs.io/), [SQLite](https://www.sqlite.org/) |
| Interface and docs | [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vite.dev/), [Lucide](https://lucide.dev/), [Mermaid](https://mermaid.js.org/), [KaTeX](https://katex.org/), [react-markdown](https://github.com/remarkjs/react-markdown), [remark-math](https://github.com/remarkjs/remark-math), [rehype-katex](https://github.com/remarkjs/remark-math/tree/main/packages/rehype-katex) |
| Development and operations | [uv](https://docs.astral.sh/uv/), [Bun](https://bun.sh/), [Docker](https://www.docker.com/), [Nginx](https://nginx.org/), [GitHub Actions](https://github.com/features/actions), [pytest](https://docs.pytest.org/), [Ruff](https://docs.astral.sh/ruff/), [ESLint](https://eslint.org/), [Tailwind CSS](https://tailwindcss.com/) |

The [frontend manifest](../frontend/package.json), [Bun lockfile](../frontend/bun.lock), [backend manifest](../backend/pyproject.toml), and [uv lockfile](../backend/uv.lock) record dependencies and resolved versions. Packages and assets retain their own licenses. No project-wide LICENSE file is currently supplied; public hosting does not itself grant a reuse license for all contents.

Coding assistance: [OpenAI Codex](https://openai.com/codex/) and [Google Gemini](https://gemini.google.com/), disclosed in [AI assistance](ai-disclosure.md).
