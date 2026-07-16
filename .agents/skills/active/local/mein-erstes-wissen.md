---
type: skill
name: LaundryList Android Application Architecture
description: A comprehensive blueprint for an offline-first, Android-native laundry management system featuring Kanban workflows, Google ecosystem integration (Sheets/Drive), and B2B billing capabilities.
tags:
  - Android
  - JetpackCompose
  - Offline-First
  - Firebase
  - SaaS
  - BusinessAutomation
version: 1.0.0
---

# LaundryList Project Specification

## 1. Project Overview & Context
- **Target Platform:** Android (Kotlin/Jetpack Compose or Flutter). Optimized for tablets (counter) and smartphones (staff).
- **Architecture:** Offline-First with background synchronization.
- **Languages:** Thai (th), English (en) with full i18n support.

## 2. Core Functional Modules

### A. Operations & Workflow
- **Goods Receipt:** Customer profiling with permanent preferences, weight/piece tracking, Express toggle, damage photo capture, and QR-based ticketing.
- **Process Management:** Kanban-style status tracking (Queued, Washing, Drying, Ironing, Ready). Includes "Express" priority visual tags and automated Employee Accountability logs (timestamp + staff ID).
- **Goods Issue:** QR/Phone-based pickup and dynamic PromptPay QR generation.

### B. Billing & B2B
- **Batch Processing:** Aggregation of orders for corporate/B2B clients.
- **Data Handling:** CSV import for legacy/external data; PDF export for invoices.

### C. Data & Infrastructure
- **Cloud Sync:** Automated Google Sheets integration for real-time reporting and daily Google Drive snapshots.
- **Universal Export:** Support for CSV (accounting) and Markdown (messaging/AI-ready).
- **Analytics:** Visual dashboard (charts) and predictive profit forecasting.
- **Utility:** Local weather API integration for staff operational awareness.
- **Maintenance:** Dedicated Machine Status & Defect Logbook.

## 3. Technical Schema
- **Data Entities:** Customers, Orders, Order_History_Logs, Billing_Lists, Machines, Staff_Users, Transactions.
- **Tech Stack Requirements:**
    - **Backend:** Firebase (Real-time DB, Auth).
    - **APIs:** Google Sheets API, Google Drive API, Weather API.
    - **Local:** Android Native File System APIs for CSV/Markdown parsing.

## 4. UI/UX Design Guidelines
- **Theme:** "Cute and Clean" aesthetic using pastel palettes.
- **Usability:** Android Material Design, high-contrast, large touch targets for high-paced work environments, micro-animations for feedback.

## 5. Development Directives
1. Initialize with **Offline-First** local caching.
2. Implement robust Firebase authentication and sync.
3. Build native Import/Export module for CSV/MD handling.
4. Enforce strict audit trails in `Order_History_Logs` on every status transition.
5. Deploy scalable i18n framework from v1.0.0.