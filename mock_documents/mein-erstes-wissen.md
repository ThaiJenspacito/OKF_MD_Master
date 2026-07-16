# System Prompt for Studio AI: "LaundryList" Application (Android Optimized - Final Version)

## 1. Project Overview & Context
Act as an expert Android app developer and UI/UX designer. Your task is to build "LaundryList", a comprehensive, user-friendly, and visually appealing ("cute and clean" aesthetic) management application for small laundry businesses. 

**Platform Requirement:** 
- **Target Platform:** Android natively (Kotlin/Jetpack Compose OR Flutter optimized for Android). The app must run smoothly on standard Android tablets (counter) and smartphones (staff)[cite: 5].
- **Core Architecture:** **Offline-First Modus**. Local data caching ensuring the staff can create orders and update statuses without an active internet connection. Seamless background synchronization once connection is restored[cite: 5].

**Language Requirements:**
- **Primary Language:** Thai (th)[cite: 5]
- **Secondary Language:** English (en)[cite: 5]
- *Implement i18n (Internationalization) from the start. All UI text must be easily toggleable between Thai and English.*

## 2. Core Workflows & Features

### A. Goods Receipt (Inbound / Dirty Laundry)
- **New Order Creation:** Customer selection/creation (Name, Phone number, LINE ID)[cite: 5].
- **Smart Customer Preferences:** Upon selecting a customer, display an immediate persistent note/info box highlighting their permanent preferences (e.g., "No softener", "Fold only, no ironing", "Allergic to scented detergents")[cite: 5].
- **Laundry Input & Express Toggle:** Track items by weight (kg) or piece count. Include a highly visible **[EXPRESS]** toggle switch. Activating it applies a predefined percentage or flat fee surcharge to the order total[cite: 5].
- **Condition Check:** Option to take a photo of damages/stains upon receipt (to avoid liability disputes)[cite: 5].
- **Ticketing:** Generate a digital or printable receipt with a unique Order ID and QR code[cite: 5].

### B. The Washing Process (Status Tracking & Accountability)
- **Kanban-style Board:** 
  - `Queued` (รอคิว) -> `Washing` (กำลังซัก) -> `Drying` (กำลังอบ) -> `Ironing` (กำลังรีด) -> `Ready for Pickup` (รอรับ)[cite: 5].
- **Priority Sorting:** Orders flagged as **Express** must automatically jump to the top of the queue and display a vibrant visual tag (e.g., pulsing red border)[cite: 5].
- **Quick Actions:** One-tap status updates with large, easy-to-hit buttons designed for busy environments[cite: 5].
- **Employee Log & Accountability:** Every time an order status is changed, the system must silently capture a timestamp and the ID/Name of the logged-in staff member responsible for that specific operational step[cite: 5].

### C. Goods Issue (Outbound / Clean Laundry)
- **Pickup Flow:** Scan QR code or search by phone number to pull up the active order[cite: 5].
- **Payment Collection:** Calculate totals, apply discounts. Generate active, dynamic PromptPay QR codes with the exact due amount for seamless scanning[cite: 5].

### D. Billing Lists, Data Import & B2B Invoicing (Abrechnungslisten)
- **Batch Processing:** Ability to group multiple separate orders for B2B or regular customers (e.g., local hostels, restaurants, businesses) into a single weekly or monthly billing list[cite: 5].
- **Data Import (Billing):** Implement a native data import function via CSV. This allows the owner to import external data (like hotel guest lists, legacy outstanding balances, or external custom expenses) directly into the billing module[cite: 5].
- **Invoice Generation:** Export beautifully structured billing lists and invoices as PDF[cite: 5].

### E. Data Retention, Sync & Export (Google & Local)
- **Automated Google Sheets Sync:** Automatically mirror all completed orders, generated billing lists, and daily financial data (income/expenses) to a designated, secure Google Sheet for live external processing[cite: 5].
- **Google Drive Backup:** Automated daily snapshot backups of the database to the owner's Google Drive, ensuring absolute data safety and longevity[cite: 5].
- **Manual Universal Export (CSV & MD):** Provide a flexible "Export Data" module. Users can manually export financial reports, billing lists, or order histories directly to:
  - **.CSV:** For traditional spreadsheet accounting (Excel/Google Sheets)[cite: 5].
  - **.MD (Markdown):** For clean, text-based readability, easy sharing via messaging apps (like LINE), or feeding the data into AI tools for rapid business analysis[cite: 5].

### F. Analytics, Utility Widgets & Financial Dashboard
- **Visual Dashboard:** Use charts (Bar, Line, Pie) to visualize revenue, expenses, and laundry volume trends[cite: 5].
- **Profit Forecasting:** A predictive module forecasting upcoming monthly profits based on historical trends[cite: 5].
- **Weather Info Display Field:** A simple, lightweight info card on the dashboard showing the current local weather and forecast via a basic weather API. This acts purely as an operational helper for staff to see if rain is expected, without modifying backend timelines automatically[cite: 5].

### G. Machine Management & Defect Logbook
- **Machine Status Tracker:** A dedicated panel to list physical washing machines and dryers in the shop[cite: 5].
- **Defect Log:** Allow staff to mark a machine as `Active`, `Under Maintenance`, or `Defekt`[cite: 5].

## 3. Database Schema (Suggested)
- **Customers:** `id`, `name`, `phone`, `line_id`, `type` (Retail/B2B), `permanent_preferences`[cite: 5].
- **Orders:** `id`, `customer_id`, `status`, `total_price`, `weight_kg`, `is_express`, `dropoff_date`, `pickup_date`, `payment_status`[cite: 5].
- **Order_History_Logs:** `id`, `order_id`, `status_changed_to`, `changed_by_user_id`, `timestamp`[cite: 5].
- **Billing_Lists:** `id`, `customer_id`, `billing_period`, `total_amount`, `status`[cite: 5].
- **Machines:** `id`, `name`, `type` (Washer/Dryer), `status` (Active/Maintenance/Defect)[cite: 5].
- **Staff_Users:** `id`, `name`, `role`[cite: 5].
- **Transactions (Finances):** `id`, `type` (income/expense), `amount`, `category`, `date`[cite: 5].

## 4. UI/UX & Design Guidelines
- **Theme:** Clean, modern, and "cute". Use soft pastel colors (light blues, fresh greens, soft whites) to evoke cleanliness. Incorporate subtle micro-animations (e.g., a spinning washer icon when processing)[cite: 5].
- **Simplicity:** High-contrast, large touch targets for Android Material Design, engineered for fast-paced environments where hands might be busy[cite: 5].
- **File Picker:** Standard Android native file picker integration for importing CSV files seamlessly[cite: 5].

## 5. Technical Instructions for Studio AI
1. Initialize the project prioritizing an Android-first, **Offline-First** database caching mechanism[cite: 5].
2. Set up Firebase for real-time DB sync, data persistence, and Google Authentication[cite: 5].
3. Integrate Google Sheets API, Google Drive API, and a basic Weather API for the dashboard info card[cite: 5].
4. Implement robust Import/Export logic using native Android file system APIs for parsing/writing CSV and Markdown (.md) files[cite: 5].
5. Ensure the `Order_History_Logs` table correctly intercepts all status updates on the Kanban board for audit trails[cite: 5].
6. Set up the i18n framework for seamless Thai/English toggle across the entire application[cite: 5].