# Research notes

Research date: 2026-10-26. These notes record the sources that shaped Agent Incident
Investigator's product, safety, UX, and architecture decisions. Every entry was checked
against a primary page (publisher, proceedings, DOI registry, arXiv, or the maintainer's
own documentation) on that date. Claims attributed to a source are limited to what that
source states. Where only an abstract or documentation page was read, that is noted.

Source types are marked as:

- **Peer-reviewed**: conference or journal publication.
- **Preprint**: not (or not yet) published at a peer-reviewed venue.
- **Official documentation**: specification, standard, or maintainer documentation. Not
  peer-reviewed.

## Bibliography

### 1. Failure attribution in agent traces is hard, even for strong models

Shaokun Zhang, Ming Yin, Jieyu Zhang, Jiale Liu, Zhiguang Han, Jingyang Zhang, Beibin Li,
Chi Wang, Huazheng Wang, Yiran Chen, Qingyun Wu. **"Which Agent Causes Task Failures and
When? On Automated Failure Attribution of LLM Multi-Agent Systems."** _Proceedings of the
42nd International Conference on Machine Learning (ICML 2025)_, PMLR 267:76583–76599.
**Peer-reviewed.** <https://proceedings.mlr.press/v267/zhang25cq.html> (preprint:
<https://arxiv.org/abs/2505.00212>)

- **Finding:** On the Who&When dataset of annotated failure logs, "the best method achieves
  53.5% accuracy in identifying failure-responsible agents but only 14.2% in pinpointing
  failure steps."
- **Influence:** The app never presents a single automated "root cause". Deterministic
  rules remain the baseline, every finding names the exact events behind it so a person
  can judge the decisive step, and the optional model is limited to a cited summary rather
  than fault localization.

### 2. Long-context LLMs perform poorly at trace debugging

Darshan Deshpande, Varun Gangal, Hersh Mehta, Jitin Krishnan, Anand Kannappan, Rebecca
Qian. **"TRAIL: Trace Reasoning and Agentic Issue Localization."** arXiv:2505.08638, v3
(23 June 2025). **Preprint** (no venue listed on arXiv).
<https://arxiv.org/abs/2505.08638>

- **Finding:** The authors annotate 148 agent traces with an error taxonomy and report that
  "modern long context LLMs perform poorly at trace debugging", with "the best
  Gemini-2.5-pro model scoring a mere 11% on TRAIL."
- **Influence:** Model output is shown separately from deterministic findings, labelled
  _model-generated_ and _unverified_, and never promoted to a diagnosis. The bundled
  evaluation fixture measures citation behaviour and injection resistance, not "accuracy",
  because a small local model is not expected to localize faults reliably.

### 3. Many multi-agent failures are design and verification failures, not tool errors

Mert Cemri, Melissa Z. Pan, Shuyi Yang, Lakshya A. Agrawal, Bhavya Chopra, Rishabh Tiwari,
Kurt Keutzer, Aditya Parameswaran, Dan Klein, Kannan Ramchandran, Matei Zaharia, Joseph E.
Gonzalez, Ion Stoica. **"Why Do Multi-Agent LLM Systems Fail?"** NeurIPS 2025 (poster),
<https://neurips.cc/virtual/2025/poster/121528>; arXiv:2503.13657, v3 (26 Oct 2025),
<https://arxiv.org/abs/2503.13657>. **Peer-reviewed** (NeurIPS 2025; the track was not
confirmed from a primary page).

- **Finding:** From 1600+ annotated traces across 7 frameworks, the MAST taxonomy has 14
  failure modes in 3 categories: system design issues, inter-agent misalignment, and task
  verification (inter-annotator κ = 0.88).
- **Influence:** The rule set is deliberately scoped to _execution-level_ evidence (tool
  failures, retries, permissions, missing results, malformed input), and the README states
  that design and verification failures are out of scope. The one verification-style check
  the app can make deterministically, a run that reports success despite an unrecovered tool
  failure, is reported as an observation rather than ignored.

### 4. Content an LLM reads can act as instructions

Kai Greshake, Sahar Abdelnabi, Shailesh Mishra, Christoph Endres, Thorsten Holz, Mario
Fritz. **"Not What You've Signed Up For: Compromising Real-World LLM-Integrated
Applications with Indirect Prompt Injection."** _Proceedings of the 16th ACM Workshop on
Artificial Intelligence and Security (AISec '23)_, pp. 79–90, 2023.
**Peer-reviewed.** <https://doi.org/10.1145/3605764.3623985> (metadata verified via
Crossref; preprint: <https://arxiv.org/abs/2302.12173>)

- **Finding:** "LLM-Integrated Applications blur the line between data and instructions";
  attackers can plant prompts "into data likely to be retrieved".
- **Influence:** Agent traces are full of retrieved web pages, tool outputs, and user text,
  so the app treats every trace value as untrusted. It renders values as text (never HTML),
  gives the local model no tools, and never lets model output trigger any action.

### 5. Marking untrusted input reduces indirect prompt injection

Keegan Hines, Gary Lopez, Matthew Hall, Federico Zarfati, Yonatan Zunger, Emre Kıcıman.
**"Defending Against Indirect Prompt Injection Attacks With Spotlighting."** _Proceedings of
the Conference on Applied Machine Learning in Information Security (CAMLIS 2024)_,
CEUR-WS Vol-3920, pp. 48–62. <https://ceur-ws.org/Vol-3920/> (preprint:
<https://arxiv.org/abs/2403.14720>). Conference proceedings; peer-review process not
independently verified.

- **Finding:** Transforming untrusted input so the model can tell where it came from
  (delimiting, datamarking, or encoding) reduced attack success "from greater than 50% to
  below 2%" in the authors' GPT-family experiments, "with minimal impact on task efficacy."
- **Influence:** The model prompt wraps the trace in a delimited block with a random
  per-request boundary, serializes it as JSON (so injected text stays inside JSON strings),
  and tells the model that everything inside the block is data. Effectiveness for small
  local models was not measured by the paper; see open questions.

### 6. OWASP guidance for prompt injection

OWASP Gen AI Security Project. **"LLM01:2025 Prompt Injection."** OWASP Top 10 for LLM
Applications 2025. **Official documentation (industry guidance).**
<https://genai.owasp.org/llmrisk/llm01-prompt-injection/>

- **Guidance:** "Separate and clearly denote untrusted content", constrain model behaviour
  in the system prompt, "use deterministic code to validate adherence" to expected output
  formats, restrict the model to "the minimum necessary", and keep humans in the loop for
  privileged operations.
- **Influence:** The model call uses a JSON schema (Ollama structured outputs) and the app
  validates the result in code: shape, length, and that every cited event ID exists. The
  model has no tools or privileges, and nothing it says is acted on automatically.

### 7. Design guidelines for human–AI interaction

Saleema Amershi, Dan Weld, … Eric Horvitz (13 authors). **"Guidelines for Human-AI
Interaction."** _Proceedings of the 2019 CHI Conference on Human Factors in Computing
Systems_, pp. 1–13. **Peer-reviewed.** <https://doi.org/10.1145/3290605.3300233>

- **Guidance:** 18 guidelines, including G1 "Make clear what the system can do", G2 "Make
  clear how well the system can do what it can do", G8 "Support efficient dismissal", G9
  "Support efficient correction", and G11 "Make clear why the system did what it did".
  Guideline titles were checked against Microsoft's HAX Design Library
  (<https://www.microsoft.com/en-us/haxtoolkit/library/>), which publishes the same set.
- **Influence:** The Runs page states what the tool does, and the analysis panel says what
  findings are not: root causes (G1). Each finding shows its confidence with a
  plain-language reason (G2) and its rule and evidence (G11), and the "How findings are
  produced" panel documents every rule. Developers can mark each finding as checked or
  dismiss it, and undo either (G8, G9); findings are suggestions to verify, not verdicts.

### 8. Explanations reduce overreliance when they make verification cheaper

Helena Vasconcelos, Matthew Jörke, Madeleine Grunde-McLaughlin, Tobias Gerstenberg, Michael
S. Bernstein, Ranjay Krishna. **"Explanations Can Reduce Overreliance on AI Systems During
Decision-Making."** _Proceedings of the ACM on Human-Computer Interaction_ 7(CSCW1),
pp. 1–38, 2023. **Peer-reviewed.** <https://doi.org/10.1145/3579605>

- **Finding:** People decide whether to engage with an explanation by weighing its cost
  and benefit; explanations reduced overreliance in conditions where they lowered the cost
  of verifying the AI's answer (five studies, N = 731).
- **Influence:** Verification is made as cheap as possible: every claim (deterministic or
  model) links to its events in one click, the event opens beside the claim, and findings
  separate _what was observed_ from _what it might mean_.

### 9. How an LLM expresses uncertainty changes reliance

Sunnie S. Y. Kim, Q. Vera Liao, Mihaela Vorvoreanu, Stephanie Ballard, Jennifer Wortman
Vaughan. **"'I'm Not Sure, But…': Examining the Impact of Large Language Models'
Uncertainty Expression on User Reliance and Trust."** _The 2024 ACM Conference on
Fairness, Accountability, and Transparency (FAccT '24)_, pp. 822–835. **Peer-reviewed.**
<https://doi.org/10.1145/3630106.3658941>

- **Finding:** In a pre-registered experiment (N = 404, medical questions), first-person
  uncertainty expressions decreased agreement with the system and increased accuracy;
  impersonal phrasing had weaker, non-significant effects. The authors stress that the
  precise wording matters.
- **Influence:** The model is instructed to hedge in the first person when evidence is
  thin and to set an explicit "insufficient evidence" flag, which the UI surfaces. Heuristic
  confidence labels always carry a reason rather than a bare score.

### 10. OpenTelemetry semantic conventions for GenAI agents

OpenTelemetry. **"Semantic Conventions for GenAI agent and framework spans."**
`open-telemetry/semantic-conventions-genai`, `docs/gen-ai/gen-ai-agent-spans.md`.
**Official specification** (Status: Development).
<https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md>

- **Guidance:** Agent invocations are `invoke_agent` spans; tool executions are
  `execute_tool` spans identified by `gen_ai.tool.name` and, when provided,
  `gen_ai.tool.call.id`. Tool arguments and results (`gen_ai.tool.call.arguments`,
  `gen_ai.tool.call.result`) and message content are **Opt-In** and flagged as possibly
  containing sensitive information.
- **Influence:** The app's trace format keeps the same concepts (run ≈ agent invocation;
  tool call and result linked by call ID), which makes an OpenTelemetry import adapter the
  natural next integration. The opt-in/sensitive status of content reinforces local-only
  processing and redaction before export or model analysis.

### 11. Ollama: local runtime contract

Ollama. **API reference, structured outputs, FAQ, and source.** **Official documentation.**

- `POST /api/chat`: <https://docs.ollama.com/api/chat>. Accepts `format` (`"json"` or a
  JSON schema), `options` (`temperature`, `num_ctx`, `num_predict`), `stream`, `think`
  (`false` disables thinking), and `keep_alive`.
- Structured outputs: <https://docs.ollama.com/capabilities/structured-outputs>. Recommends
  also passing the schema in the prompt and a temperature of `0`; notes that "Ollama's cloud
  currently does not support structured outputs."
- FAQ: <https://docs.ollama.com/faq>. "Ollama binds 127.0.0.1 port 11434 by default";
  "Ollama runs locally. We don't see your prompts or data when you run locally."
- `GET /api/tags`: <https://docs.ollama.com/api/tags>. Model entries include
  `remote_model` and `remote_host` "if the model is remote".
- Default CORS origins, from source
  (<https://github.com/ollama/ollama/blob/main/envconfig/config.go>, `AllowedOrigins`):
  `http(s)://localhost`, `127.0.0.1`, and `0.0.0.0`, each with any port, plus app/file
  schemes; `OLLAMA_ORIGINS` adds to these.
- **Influence:** The browser can call `http://127.0.0.1:11434` directly from the dev or
  preview server, so no proxy or backend is needed. The app refuses non-loopback endpoints
  and refuses models that `/api/tags` reports as remote, or whose name carries a `cloud`
  tag, so trace data cannot be routed to Ollama's cloud.

### 12. Selected model: IBM Granite 4.2 3B

IBM Granite Team. **Granite-4.2-3B model card.** Released August 25, 2026. License Apache
2.0. **Official documentation.** Model card: <https://huggingface.co/ibm-granite/granite-4.2-3b>;
repository: <https://github.com/ibm-granite/granite-4.2-language-models>; runtime package:
<https://ollama.com/library/granite4.2>.

- **Facts from the card and library page:** dense decoder-only transformer, 3B parameters
  (Hugging Face metadata lists 4B); "Natively Supports 128K" context; built-in thinking with
  a non-thinking mode; English-first fine-tuning; may "occasionally produce inaccurate,
  biased, or unsafe responses". Ollama lists `granite4.2:3b` at 2.2 GB with a 128K context
  and text-only input.
- **Influence:** Chosen as the default because it is permissively licensed, text-only (no
  vision weights to download), small enough to run fully on the 6 GB laptop GPU used for
  development, and long-context. Thinking is turned off (`think: false`) because the app
  needs a short schema-constrained answer, not a reasoning transcript.

## Model selection notes

Hardware inspected on 2026-10-26 (read-only): NVIDIA GeForce RTX 4050 Laptop GPU with
6141 MiB VRAM, 23.7 GB system RAM, Intel Core i5-13450HX. No inference runtime was
installed; `~/.ollama/models` was empty.

Candidates considered, from each model's Ollama library page on 2026-10-26:

| Model tag       | Download   | Context | License shown         | Why not the default                                   |
| --------------- | ---------- | ------- | --------------------- | ----------------------------------------------------- |
| `granite4.2:3b` | 2.2 GB     | 128K    | Apache 2.0            | Selected                                              |
| `granite4.2:8b` | 5.3 GB     | 128K    | Apache 2.0            | Leaves little VRAM for context on a 6 GB GPU          |
| `qwen3.5:4b`    | 3.3–4.0 GB | 256K    | Not shown on the page | Larger multimodal download; license not verified here |
| `gemma4:e2b`    | 4.6–7.5 GB | 128K    | Not shown on the page | Multimodal; larger download                           |

The model is configurable in the app, so any locally installed Ollama model can be used.

## How the research changed the product

| Decision                                                                                          | Sources |
| ------------------------------------------------------------------------------------------------- | ------- |
| Deterministic rules are the baseline; the model only summarizes                                   | 1, 2    |
| Findings name their evidence events; "observed" is separated from "interpretation"                | 1, 7, 8 |
| Confidence always comes with a plain-language reason; model hedges in first person                | 7, 9    |
| Each finding can be marked checked or dismissed (and undone); the review is kept in exports       | 7       |
| One-click evidence beside every claim (model claims included)                                     | 8       |
| Trace content treated as untrusted; rendered as text; model has no tools                          | 4, 6    |
| Delimited untrusted-data block with a random boundary in the model prompt                         | 5, 6    |
| JSON-schema output validated in code; uncited or unknown citations flagged                        | 6, 11   |
| Local-only model calls; loopback endpoints only; remote/cloud models refused                      | 10, 11  |
| Redaction before export and before model analysis                                                 | 10, 6   |
| Rules scoped to execution-level failures; design/verification failures documented as out of scope | 3       |
| Trace format aligned with OpenTelemetry concepts for a future import adapter                      | 10      |
| Default model `granite4.2:3b` with thinking off                                                   | 11, 12  |

## Limitations, disagreements, and open questions

- **Generalization.** Sources 1–3 study multi-agent research systems and benchmark tasks;
  source 9 studied medical questions with a fictional search engine; source 8 used a maze
  task. Their effects may differ for developers debugging their own agents.
- **Injection defenses are not guarantees.** Spotlighting was evaluated on GPT-family
  models; it says nothing about 3B local models. OWASP describes mitigations, not
  prevention. The app reduces the impact of injection (no tools, validated output, human
  review) rather than claiming to stop it.
- **Grounding checks are shallow.** The app verifies that cited event IDs exist, not that
  the cited events actually support the claim. A model can cite the right event and still
  misread it.
- **OpenTelemetry is still in Development.** Attribute names may change; secondary blogs
  disagree about stabilization, and the official documents still say Development.
- **Model facts move quickly.** Library sizes, tags, and "updated" dates were read on the
  research date and may change; the README records the date.
- **Open question:** whether first-person hedging from a small model improves developer
  decisions in this tool. That would need a user study, which has not been done.
