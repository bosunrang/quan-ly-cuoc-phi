# Quản lý cước phí

Ứng dụng quản lý cước phí giao hàng dùng chung cho nhiều máy trong mạng nội bộ.
Admin cài ứng dụng trên máy chính; nhân viên vào bằng trình duyệt trên máy của họ.

Stack giống Marketing App: **React 19 + TypeScript + Vite + Electron**, dữ liệu
lưu bằng SQLite tích hợp sẵn trong Node (`node:sqlite`).

## Đang có gì

Ứng dụng đã có kiểm thử cho: đăng nhập, phiên làm việc, phân quyền theo thẻ,
giới hạn dữ liệu theo người tạo, nhật ký thao tác, nhập cước, danh mục khách
hàng/nhà xe/bảng cước, báo cáo cước nhân viên và báo cáo chênh lệch cước nhà
xe. File MISA luôn được kiểm tra và xem trước; chỉ các dòng hợp lệ, chưa trùng
mới được ghi vào SQLite.

## Chạy môi trường phát triển

```bash
npm install
```

Mở hai terminal:

```bash
npm run server:dev
```

Lệnh phát triển này chỉ lắng nghe trên máy cục bộ và tự đăng nhập bằng tài khoản
Admin để làm giao diện nhanh. Muốn kiểm tra đầy đủ màn đăng nhập và phân quyền,
chạy server mặc định ở chế độ bảo mật:

```bash
npm run server
```

```bash
npm run dev
```

Giao diện chạy ở `http://localhost:5173` và tự chuyển tiếp `/api` sang server ở
cổng 3100. Lần chạy đầu tiên, mật khẩu Admin vẫn được in ra console — hãy giữ
lại để kiểm tra chế độ bảo mật và dùng cho bản đóng gói sau này.

Muốn chạy như bản thật (một cổng duy nhất):

```bash
npm run build
npm run server
```

Rồi mở `http://localhost:3100`.

## Tính quãng đường bằng VietMap

Ứng dụng lấy km tự động trong mục **Tính xăng** thông qua VietMap Map API.
Tạo *Services key* tại VietMap rồi cấu hình key **chỉ trên máy chủ**; không đặt
key vào mã giao diện hoặc máy nhân viên.

Khi phát triển, chạy PowerShell ở thư mục dự án:

```powershell
$env:VIETMAP_API_KEY = "key-cua-ban"
npm run server:dev
```

Với bản Electron đã cài, đặt biến môi trường Windows một lần trên máy chủ,
sau đó đóng hẳn và mở lại ứng dụng:

```powershell
setx VIETMAP_API_KEY "key-cua-ban"
```

Ứng dụng gửi địa chỉ đến VietMap từ backend, nhận tọa độ rồi tính tuyến đường
cho profile ô tô. Chặng đã lưu được ưu tiên và không gọi API lại.

## Kiểm thử

```bash
npm run check
```

Gồm lint (Biome), typecheck, kiểm tra cú pháp lớp Electron, test giao diện
(Vitest) và test máy chủ (`node --test`).

Test máy chủ tập trung vào ranh giới quyền: nhân viên không vào được màn hình
quản trị, không thấy phiếu người khác, không sửa được phiếu người khác, và không
lách được bằng cách gửi thêm tham số.

## Đóng gói bản cài đặt

```bash
npm run dist
```

Kết quả nằm trong `release/`. Bộ cài tạo sẵn shortcut Desktop và Start Menu.

## Phát hành và tự động cập nhật

Ứng dụng Windows đã cài đặt sẽ tự kiểm tra GitHub Releases sau khi mở. Khi có
bản mới, ứng dụng tải nền và hỏi người dùng có muốn cài đặt ngay hay không.
Mã nguồn và các bộ cài được phát hành tại
[`bosunrang/quan-ly-cuoc-phi`](https://github.com/bosunrang/quan-ly-cuoc-phi).

Để phát hành phiên bản mới, sau khi mọi thay đổi đã được commit và đẩy lên
GitHub, tạo một tag trùng với phiên bản trong `package.json`, ví dụ:

```bash
git tag v1.0.6
git push origin main --tags
```

GitHub Actions sẽ tự đóng gói Windows, tạo GitHub Release và đính kèm bộ cài
cùng tệp `latest.yml`. Không sửa tay hoặc trộn `latest.yml` của phiên bản khác
với bộ cài; tệp này chứa mã kiểm tra toàn vẹn của chính bộ cài đó.

Từ các bản sau có thể tăng bản vá, tạo tag và đẩy lên bằng một lệnh:

```bash
npm version patch
git push origin main --follow-tags
```

## Cách dùng trong văn phòng

1. Cài bộ cài trên **máy chính**, mở ứng dụng lên và đăng nhập.
2. Vào mục Người dùng, tạo tài khoản cho từng nhân viên và tick thẻ họ được vào.
3. Chuột phải icon dưới khay hệ thống → *Địa chỉ cho máy nhân viên* để lấy địa chỉ.
4. Trên máy nhân viên, mở Edge vào địa chỉ đó. Muốn có icon Desktop thì chọn
   menu `...` → *Ứng dụng* → *Cài đặt trang này dưới dạng ứng dụng*.

Lưu ý vận hành:

- **Máy chính phải bật** thì máy nhân viên mới làm việc được. Đóng cửa sổ ứng
  dụng không sao — nó chỉ thu nhỏ xuống khay và server vẫn chạy.
- Lần đầu chạy, Windows Firewall sẽ hỏi. Chọn cho phép ở **mạng Private**.
- Nên đặt IP tĩnh cho máy chính để địa chỉ không đổi.
- **Sao lưu tự động**: máy chủ tạo một snapshot SQLite mỗi ngày trong thư mục
  `data/backups` cạnh cơ sở dữ liệu và giữ 14 bản gần nhất. Có thể tiếp tục dùng
  nút **Xuất backup** trong Cài đặt để lưu thêm một bản ở nơi khác.
- Khi cần copy thủ công file `cost-app.sqlite` lúc ứng dụng đang chạy, copy cả
  file `-wal` nếu có.
- Chỉ dùng trong mạng nội bộ. Không mở cổng này ra Internet.

### Nhiều công ty trên cùng hệ thống

Khi mở app desktop, chọn đúng công ty trước khi đăng nhập. Mỗi lựa chọn dùng
database và cấu hình máy chủ riêng:

- **Nam Hưng Việt**: giữ dữ liệu hiện có, cổng 3100.
- **NAVIVA GROUP**: cổng 3101 khi chạy cùng máy với Nam Hưng Việt.
- **Tường Khuê** và **Winbio**: cổng 3100 trên máy chủ riêng của từng miền.

Các máy trạm chỉ cần chọn công ty tương ứng rồi nhập địa chỉ máy chủ của công
ty đó ở lần kết nối đầu tiên. Cập nhật ứng dụng chỉ đổi mã chương trình; không
trộn các database công ty.

Xem [ARCHITECTURE.md](ARCHITECTURE.md) trước khi thêm màn hình mới.
