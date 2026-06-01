# Chatbot-Application
# ⚡ Antigravity LLM Inference Logger & Ingestion System 🚀

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="NodeJS"/>
  <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white" alt="ExpressJS"/>
  <img src="https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL"/>
  <img src="https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white" alt="Redis"/>
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker"/>
  <img src="https://img.shields.io/badge/Kubernetes-326CE5?style=for-the-badge&logo=kubernetes&logoColor=white" alt="Kubernetes"/>
</p>

A state-of-the-art, lightweight, near-real-time **inference logging wrapper and validation pipeline** for LLM applications. Engineered with decoupling and reliability at its core to ensure zero performance overhead on user chat streams.

---

## 🎨 System Architecture Pipeline

The diagram below details the end-to-end event-based logging topology:

![System Architecture](assets/architecture_diagram.png)

> [!NOTE]
> The chatbot server communicates asynchronously with the ingestion API using the SDK wrapper. The user response streams are fully isolated from PostgreSQL database transactions via an intermediate Redis message buffer.

---

## 🖥️ Live Chat & Metrics Dashboard Mockup

Below is a visual representation of our high-fidelity, glassmorphic analytics interface (which supports dark and light modes!):

![Metrics Dashboard Mockup](assets/dashboard_mockup.png)

---

## 🚀 Quick Start Guide

You can run the application either in a fully-orchestrated **Docker environment** or locally via **Zero-Dependency Fallback**.

### Option 1: One-Command Docker Setup 🐳
Orchestrates PostgreSQL, Redis, Ingest API, Queue Worker, and Chat App in a unified network.

```bash
# Clone the repository and run at the root directory
docker-compose up --build
```
*   **Chatbot Web App & Dashboard**: Access [http://localhost:3000](http://localhost:3000)
*   **Ingestion REST Endpoint**: Running on [http://localhost:3001](http://localhost:3001)

### Option 2: Zero-Dependency Local Startup (SQLite Fallback) 💻
Allows immediate local testing without Docker, Postgres, or Redis configurations.

```bash
# Bootstrap local workspaces & install dependencies
npm run bootstrap

# Start the Chatbot App in local SQLite-like memory mode
npm run dev:chatbot
```
*Open [http://localhost:3000](http://localhost:3000). The SDK automatically redirects failed log posts to a local database representation, meaning the Chat UI, database logging, and Dashboard metrics remain fully functional!*

---

## 🛡️ Core Features

*   **Multi-Turn Real Chatbot**: The system slices database conversation logs to keep a short multi-turn context (last 10 turns) active, retaining user names and remembering prior turn inputs.
*   **Edge-Based PII Redaction**: Regex-based scanners redact emails, card numbers, and phone numbers before logs are enqueued.
*   **Response Stream Interception**: Supports server-sent-event chunk parsing and allows immediate manual cancels mid-generation.
*   **Throughput & Latency Dashboard**: View Average Latency, cost tracking, tokens per second, error percentages, and audit logs.

---

## 💾 Schema Design Decisions

| Table | Purpose | Highlighted Columns | Tradeoff / Decision |
| :--- | :--- | :--- | :--- |
| **`conversations`** | Session tracker | `id` (UUID), `status` (active/cancelled) | Tracks session lifespans for user retention metrics. |
| **`messages`** | Chat thread history | `role`, `content` (redacted) | Content stored *pre-redacted* by the SDK to avoid database leakage. |
| **`inference_logs`** | API request log | `latency_ms`, `raw_payload` (JSONB) | JSONB column types permit index queries over raw request structures. |
| **`extracted_metadata`** | Enriched metrics | `cost_usd`, `throughput_tps` | Separated into its own table to keep log scans light and performant. |

---

## 🔮 What We'd Improve with More Time

> [!TIP]
> *   **Semantic Logs**: Integrate Vector Embeddings (like pgvector) to query prompt similarities and identify patterns in user requests.
> *   **Deep PII Audits**: Add ML-powered entity scanners (e.g. Microsoft Presidio) to recognize complex personal identifiers beyond basic patterns.
> *   **Log Sharding**: Set up Postgres partitioned logs on a monthly interval to prevent massive query degradations.
