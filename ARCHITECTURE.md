# Kiến trúc

Cùng ngôn ngữ với Marketing App: React + TypeScript + Vite trong vỏ Electron,
tổ chức theo module nghiệp vụ. Component giao diện không tự đọc/ghi dữ liệu.

## Tổng thể

```text
Máy chính (Admin)                        Máy nhân viên
┌─────────────────────────────┐
│ Ứng dụng Electron           │          ┌─────────────┐
│  ├─ server nội bộ ─ SQLite  │◄── LAN ──┤ Trình duyệt │
│  └─ giao diện React ─┐      │          └─────────────┘
└──────────────────────┼──────┘
                       └─ HTTP tới 127.0.0.1
```

Giao diện trong Electron gọi server qua HTTP y hệt máy trạm, nên **chỉ có một
đường dữ liệu duy nhất** cho mọi máy: không có nhánh riêng cho máy chính, không
thể lệch logic phân quyền giữa hai nơi. `preload.cjs` không có hàm nào chạm cơ
sở dữ liệu. Đóng cửa sổ chỉ ẩn xuống khay hệ thống vì server phải chạy tiếp.

## Cấu trúc chuẩn

```text
src/
  app/                  Điều phối ứng dụng, cấu hình trang và điều hướng
    layout/             Header và Sidebar
  domain/               Model và quy tắc nghiệp vụ, không phụ thuộc React
    entries/            Phiếu cước: model, kiểm tra hợp lệ, repository
    users/              Tài khoản và thẻ được cấp
    audit/              Nhật ký
    auth/               Đăng nhập, phiên
    misa/               Dữ liệu bán hàng MISA và quy ước nhập Excel
    settings/           Nhận diện và cấu hình dùng chung
  features/             Module màn hình độc lập
    auth/               Màn hình đăng nhập và CSS riêng của nó
    entries/            Trang nhập cước
      components/       Hộp thoại thêm/sửa phiếu
    users/              Trang người dùng
      components/       Hộp thoại tài khoản và đặt lại mật khẩu
    audit/              Trang nhật ký
    misa/               Chọn file, kiểm tra trùng và xem trước dữ liệu MISA
    settings/           Thông tin đơn vị, logo và quản trị dữ liệu
  shared/
    api/                HTTP client duy nhất
    lib/                Định dạng tiền, ngày, tên
    ui/                 Dialog, Panel, Field, StatusPill, Alert
  styles/
    index.css           Điểm nhập CSS duy nhất, quy định thứ tự cascade
    foundation/         Token, font, reset và typography
    layout/             App shell và responsive
    shared/             Style component dùng chung
server/                 HTTP + SQLite + phân quyền (chạy độc lập được)
electron/               Vỏ desktop: cửa sổ, khay hệ thống, khởi động server
```

## Quy tắc bắt buộc

1. Màu và cỡ chữ lấy từ `styles/foundation/tokens.css`; không viết mã màu riêng
   trong component mới. Cỡ chữ chỉ khai báo trong `foundation/typography.css`.
2. Model, repository và quy tắc nghiệp vụ nằm trong `domain`; UI và state màn
   hình nằm trong `features`.
3. Feature và page **không gọi `fetch` trực tiếp** — chỉ qua repository của
   `domain`, và repository chỉ dùng `shared/api/client`.
4. **Mặc định cấm** ở máy chủ: đường dẫn không nằm trong `PUBLIC_ROUTES` bắt buộc
   có phiên hợp lệ. Quên khai quyền sẽ thành "cấm", không thành "mở toang".
5. **Người tạo lấy từ phiên đăng nhập**, không bao giờ lấy từ dữ liệu gửi lên.
6. **Bộ lọc chủ sở hữu ghép ở máy chủ.** Nhân viên gửi thêm `?createdBy=` cũng vô ích.
7. **Ẩn menu không phải là phân quyền.** Thanh điều hướng chỉ là kết quả hiển thị
   của quyền đã kiểm ở máy chủ.
8. Thẻ `adminOnly` không cấp cho nhân viên được, kể cả khi Admin bấm nhầm.
9. Thao tác đổi dữ liệu chạy trong giao dịch và ghi nhật ký trong cùng giao dịch.
10. CSS riêng của feature đặt cạnh feature đó; CSS nền chỉ import qua `styles/index.css`.
11. Trạng thái dạng nhãn dùng `shared/ui/StatusPill` với đúng năm ngữ nghĩa:
    `success`, `warning`, `info`, `neutral`, `danger`.
12. Schema đổi bằng bước migration mới trong `server/db.cjs`; không sửa bước đã chạy.

## Hướng phụ thuộc

```text
app ──> features ──> domain
 │          │           │
 └────────> shared <────┘

domain  -X-> features        (domain phải chạy được không cần React)
feature -X-> feature khác
shared  -X-> features/domain
electron ──> server          (server không biết gì về Electron)
```

`server/` phải chạy được bằng `node server/start.cjs` mà không cần Electron, để
sau này tách ra máy riêng không phải viết lại.

## Hai lớp phân quyền

| Lớp | Câu hỏi | Nơi quyết định |
|---|---|---|
| Thẻ | Được mở màn hình nào? | `user_pages` + `c.requirePage(key)` |
| Dòng dữ liệu | Thấy phiếu của ai? | `entries.created_by` + `canSeeEveryone()` |

## Thêm một màn hình mới

1. Thêm một dòng vào `PAGES` trong `server/permissions.cjs`.
2. Tạo `server/routes/<tên>.cjs`; mọi handler mở đầu bằng `c.requirePage('<key>')`.
   Đăng ký route trong `server/index.cjs`.
3. Nếu có bảng mới: thêm bước migration mới vào `server/db.cjs`, tăng `SCHEMA_VERSION`.
4. Thêm `PageId` vào `src/types.ts`, mục vào `src/app/navigation.ts` và
   `src/app/pageConfig.ts`.
5. Tạo `src/domain/<tên>/` (model + repository) và `src/features/<tên>/`.
6. Viết test cho ranh giới quyền của màn hình đó.

Ô tick trong màn hình Người dùng tự sinh từ `PAGES`, không phải sửa tay.

## An toàn

- Mật khẩu băm scrypt với salt riêng; token phiên chỉ lưu bản băm SHA-256.
- Sai mật khẩu 8 lần thì khóa 15 phút. Thông báo lỗi giống nhau cho mọi trường
  hợp sai, để không lộ tài khoản nào có thật.
- Đổi mật khẩu hoặc bị khóa tài khoản thì mọi phiên đang mở bị cắt.
- Token giữ trong `sessionStorage`, không phải `localStorage`: đóng tab là mất.
- Tự đăng nhập phát triển chỉ nhận yêu cầu loopback trên máy chính; bản Electron
  và `npm run server:secure` không mở đường dẫn này.
- Electron bật `contextIsolation`, `sandbox`, chặn điều hướng ra ngoài.
- Server chỉ dùng trong mạng LAN. Mật khẩu truyền dạng HTTP thường, **không
  được mở cổng này ra Internet**.

## Giới hạn đã biết

- Phiếu không có bước duyệt và không khóa sau khi nhập, theo yêu cầu. Nhật ký là
  công cụ truy vết duy nhất khi số liệu thay đổi.
- Báo cáo chênh lệch nhà xe chỉ tính các phiếu khớp được khách hàng, nhà xe và
  quy cách trong bảng cước đã thiết lập.
- Nhập Excel hiện hỗ trợ mẫu **Sổ chi tiết bán hàng MISA**; chưa hỗ trợ tự ánh
  xạ các mẫu cột tùy biến khác.
