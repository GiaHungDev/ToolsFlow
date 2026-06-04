# Kiến trúc Ứng dụng Harumi AI

**Harumi AI** là một hệ thống phần mềm Desktop (được xây dựng trên nền tảng Electron và Next.js) kết hợp với Backend Core mạnh mẽ (NestJS). Hệ thống được thiết kế chuyên biệt để tự động hóa quy trình sáng tạo nội dung, đặc biệt là việc tự động hóa quá trình tạo Video AI (Veo3) thông qua nền tảng Google Labs.

**Các chức năng cốt lõi của hệ thống bao gồm:**
1. **Bảo mật & Định danh:** Quản lý đăng nhập, giữ phiên (session) an toàn qua hệ thống Auth độc lập.
2. **Quản trị Tài nguyên (Admin Dashboard):** Quản lý tập trung các tài khoản Flow (Google Labs), tài khoản phần mềm Automation (BAS) và phân quyền/theo dõi người dùng (Automation Users).
3. **Quy trình Tự động hóa AI (FlowAI 5 Bước):** 
   - Quản lý luồng công việc từ lúc tạo kịch bản (Upload Excel), dựng storyboard cho đến khi xuất danh sách Video.
   - Tích hợp công cụ Browser Automation (Puppeteer/Playwright) chạy ngầm ngay bên trong Desktop App. Công cụ này sẽ tự động đăng nhập (qua Cookies hoặc Code lấy từ API), nhập Prompt và tương tác trực tiếp với Google Labs để sinh ra Video AI.
4. **Đồng bộ & Lưu trữ:** Theo dõi trạng thái tiến trình Video từ xa và tự động tải Video hoàn chỉnh về lưu trữ tại ổ cứng cục bộ (Local File System) của người dùng.

Tài liệu dưới đây cung cấp cái nhìn chi tiết về sơ đồ luồng (Flowchart), trình tự gọi API (Sequence Diagram), sơ đồ cơ sở dữ liệu (ERD) và kiến trúc tổng thể của hệ thống.
## 1. Sơ đồ Luồng (Flowchart)

```mermaid
flowchart TD
    A["Khởi động Harumi AI"] --> B["electron/main.js"]
    B --> C{"Kiểm tra Môi trường"}
    
    C -->|Development| D["Đợi Next.js Server cục bộ"]
    C -->|Production| E["Khởi chạy .next/standalone/server.js"]
    
    D --> I["Next.js App Router"]
    E --> I["Next.js App Router"]
    
    I -->|Quản lý State| J["Redux: authSlice<br/>Quản lý toàn bộ trạng thái Đăng nhập / Đăng xuất"]
    I -->|Interceptor| K{"AuthWrapper / useAuth"}
    
    K -->|Kiểm tra Login| J
    J -.->|Gọi hàm checkMe| S["Auth API: https://api.dashboard.yteco.live"]
    
    J -.->|Không hợp lệ| L["Redirect: https://harumi.vfast.pro/home-landing"]
    J -.->|Hợp lệ| M["Truy cập thành công"]
    
    I -->|Route Auth| N["app/auth"]
    
    I -->|Route Protected| O["app/protected"]
    O --> K
    
    M --> O1["Render: app/protected/layout"]
    O1 --> O2{"Điều hướng Route"}
    
    O2 -->|app/protected/flow-ai| O3["Trang FlowAI"]
    O3 --> O3a["Component: FlowAI - Quản lý State 5 Steps"]
    
    O3a --> S1["Step 1: API Key"]
    O3a --> S2["Step 2: Tạo Kịch Bản / Upload Excel"]
    O3a --> S3["Step 3: Storyboard / Lưu cảnh"]
    O3a --> S4["Step 4: Danh sách Video TableSection"]
    O3a --> S5["Step 5: Veo3"]
    
    S5 --> V1{"Chọn phương thức Login"}
    V1 -->|Cách 1| V2["Nhập text Cookies thủ công"]
    V1 -->|Cách 2| V3["Lấy code từ API<br/>POST /bas/check-account"]
    
    V2 --> V4["Đăng nhập thành công"]
    V3 --> V4
    
    V4 --> V5["Nhập Prompt tạo Video"]
    V5 --> V6["Đợi Video hoàn thành"]
    
    V6 --> V7["Cập nhật trạng thái<br/>PATCH /flow/veo3/:id/status"]
    V7 --> V8["Lưu file về máy cục bộ<br/>C:\\{tên dự án}\\video_{id}"]
    
    S4 --> O3b["Hook: useFormVideo<br/> Tạo record"]
    S4 --> O3c["Hook: useFormFilter<br/> Bộ lọc"]
    
    O2 -->|app/protected/admin| O4["Trang Admin Dashboard"]
    O4 --> O4a["Quản lý Tài khoản Flow"]
    O4 --> O4b["Quản lý Tài khoản BAS"]
    O4 --> O4c["Quản lý Người dùng"]
    O4c --> O4d["Bật/Tắt Chạy ngầm Headless"]
    O4c --> O4e["Phân quyền Admin/User"]
    
    O3a -.-> Q["Axios / Fetch"]
    O3b -.-> Q
    O3c -.-> Q
    O4a -.-> Q
    O4b -.-> Q
    O4c -.-> Q
    V3 -.-> Q
    V7 -.-> Q
    
    subgraph Máy chủ Backend
        Q ==> R["API: https://api.haru.vfast.pro"]
    end
```

## 2. Sơ đồ Tuần tự (Sequence Diagram)

Mô tả chi tiết quá trình gọi API giữa Frontend và Backend.

```mermaid
sequenceDiagram
    autonumber
    
    actor User as Người dùng (User)
    participant App as Frontend (App Electron)
    participant Auth as Auth API (yteco.live)
    participant Core as Core Backend (haru.vfast.pro)

    %% KHỐI 1: XÁC THỰC & ĐĂNG NHẬP
    note right of User: CHỨC NĂNG 1: ĐĂNG NHẬP & GIỮ PHIÊN (authSlice)
    
    User->>App: Nhập tài khoản, mật khẩu                                                                                     
    App->>Auth: POST /login (Gửi thông tin xác thực)
    Auth-->>App: Trả về Access Token & Refresh Token
    
    note over App: Hook useAuth chạy mỗi khi chuyển trang
    App->>Auth: GET /check-me (Kiểm tra token)
    Auth-->>App: Trả về thông tin User hợp lệ

    %% KHỐI 2: TRANG QUẢN TRỊ ADMIN
    note right of User: CHỨC NĂNG 2: ADMIN DASHBOARD
    
    User->>App: Truy cập /protected/admin
    par Tải dữ liệu song song (Promise.all)
        App->>Core: GET /admin/flow-accounts
        App->>Core: GET /admin/bas-accounts
        App->>Core: GET /admin/automation-users
    end
    Core-->>App: Trả về toàn bộ dữ liệu hiển thị
    
    User->>App: Bấm xóa tài khoản Flow
    App->>Core: DELETE /admin/flow-accounts/:id
    Core-->>App: Xác nhận xóa thành công

    %% KHỐI 3: QUY TRÌNH VEO3 & TẠO VIDEO
    note right of User: CHỨC NĂNG 3: VEO3 (TẠO VIDEO AI)
    
    User->>App: Chọn cách 2: Lấy code từ API
    App->>Core: POST /bas/check-account
    Core-->>App: Trả về Code / Session hợp lệ
    
    note over User,App: Quá trình đăng nhập BAS thành công
    
    User->>App: Nhập Prompt
    note over App: App ghi nhận (Hook: useFormVideo)
    
    App->>Core: POST /flow/veo3
    Core-->>App: Trả về ID của luồng Video
    
    note over App: ⏳ App Electron treo đợi render Video...
    
    App->>Core: PATCH /flow/veo3/:id/status (Cập nhật thành công)
    Core-->>App: API ghi nhận hoàn tất
    
    note over App: Thực thi lệnh Node.js lưu file (fs)
    App->>User: Lưu video vào: C:\{tên dự án}\video_{id}
```

## 3. Sơ đồ Cơ sở dữ liệu (ER Diagram)

Sơ đồ quan hệ thực thể (ERD) được trích xuất trực tiếp từ cấu trúc `schema.prisma` ở Backend (NestJS).

```mermaid
erDiagram
    %% Bảng AccountWeb (Người dùng / Automation Users)
    AccountWeb {
        Int id PK
        String username UK "Unique"
        String password
        String email UK "Unique"
        DateTime createdAt
        String computerId "Dùng cho Anti-sharing"
        Json knownDevices
        String role "Default: USER"
        Boolean isHeadless "Default: true"
    }

    %% Bảng Veo3 (Lưu trữ lịch sử tạo Video)
    Veo3 {
        Int id PK
        String projectName
        Text prompt
        Json images
        String status
        Text videoURL
        String typeI2V
        DateTime createdAt
        Int ownerId FK "Khóa ngoại trỏ đến AccountWeb"
    }

    %% Bảng FlowAccount (Tài khoản gốc Google Labs/Flow)
    FlowAccount {
        Int id PK
        String email UK "Unique"
        String password
        String twoFaCode
        Json cookies
        String codeBackup
        DateTime createdAt
        DateTime updatedAt
    }

    %% Bảng BasAccount (Tài khoản phần mềm BAS)
    BasAccount {
        Int id PK
        String username UK "Unique"
        String password
        Int staffCount
        DateTime createdAt
        DateTime updatedAt
        Int flowAccountId FK "Khóa ngoại trỏ đến FlowAccount"
    }

    %% --- QUAN HỆ (RELATIONSHIPS) ---
    
    %% Một AccountWeb (User) có thể tạo nhiều luồng Veo3
    AccountWeb ||--o{ Veo3 : "sở hữu (owner)"
    
    %% Một FlowAccount có thể cấp phát/quản lý nhiều BasAccount
    FlowAccount ||--o{ BasAccount : "quản lý"
```

## 4. Sơ đồ Kiến trúc Hệ thống (System Architecture)

Sơ đồ tổng quan cấp cao mô tả các thành phần cấu tạo nên hệ thống và cách chúng tương tác với các tác nhân (Actors) và Dịch vụ bên ngoài (External Services). Hệ thống sử dụng **Trình duyệt tự động (Puppeteer/Playwright)** tích hợp ngay bên trong Desktop App để xử lý AI.

```mermaid
flowchart TB
    User((Người dùng))

    App[🖥️ Harumi AI App]
    Backend[☁️ Core Backend Server]

    subgraph ExternalBox [🌐 Dịch vụ bên ngoài]
        AuthAPI[Hệ thống Auth<br/>api.dashboard.yteco.live]
        GoogleLabs[Google Labs / Veo3<br/>Nền tảng tạo Video AI]
    end

    User -->|Thao tác| App
    
    App -->|1. Xác thực đăng nhập| AuthAPI
    App <-->|2. Ghi/Đọc dữ liệu| Backend
    App <-->|3. Điều khiển tạo Video| GoogleLabs
```
