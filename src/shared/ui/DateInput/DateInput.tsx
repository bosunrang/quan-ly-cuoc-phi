import { CalendarDays } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const months = [
	"Tháng 1",
	"Tháng 2",
	"Tháng 3",
	"Tháng 4",
	"Tháng 5",
	"Tháng 6",
	"Tháng 7",
	"Tháng 8",
	"Tháng 9",
	"Tháng 10",
	"Tháng 11",
	"Tháng 12",
];
const days = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const pad = (value: number) => String(value).padStart(2, "0");
const iso = (year: number, month: number, day: number) => {
	const value = new Date(Date.UTC(year, month - 1, day));
	return value.getUTCFullYear() === year &&
		value.getUTCMonth() === month - 1 &&
		value.getUTCDate() === day
		? `${year}-${pad(month)}-${pad(day)}`
		: "";
};
const today = () => {
	const value = new Date();
	return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
};
const display = (value: string) =>
	/^\d{4}-\d{2}-\d{2}$/.test(value)
		? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}`
		: "";
const parse = (value: string) => {
	const found =
		value.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/) ??
		value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!found) return "";
	const [, first, second, third] = found;
	return value.includes("-") && first.length === 4
		? iso(Number(first), Number(second), Number(third))
		: iso(Number(third), Number(second), Number(first));
};

interface DateInputProps {
	id?: string;
	value: string;
	onChange: (value: string) => void;
	ariaLabel?: string;
	disabled?: boolean;
}

export function DateInput({
	id,
	value,
	onChange,
	ariaLabel = "Ngày",
	disabled = false,
}: DateInputProps) {
	const boxRef = useRef<HTMLSpanElement>(null);
	const popupRef = useRef<HTMLDivElement>(null);
	const [text, setText] = useState(() => display(value));
	const [open, setOpen] = useState(false);
	const [monthMode, setMonthMode] = useState(false);
	const [view, setView] = useState(() => {
		const [year, month] = (value || today()).split("-").map(Number);
		return new Date(year, month - 1, 1);
	});
	const [position, setPosition] = useState({ left: 8, top: 8 });
	useEffect(() => setText(display(value)), [value]);
	useLayoutEffect(() => {
		if (!open || !boxRef.current || !popupRef.current) return;
		const rect = boxRef.current.getBoundingClientRect();
		setPosition({
			left: Math.min(Math.max(8, rect.left), window.innerWidth - 266),
			top: Math.max(
				8,
				Math.min(
					rect.bottom + 6,
					window.innerHeight - popupRef.current.offsetHeight - 8,
				),
			),
		});
	}, [open]);
	useEffect(() => {
		if (!open) return;
		const close = (event: MouseEvent) => {
			const target = event.target as Node;
			if (
				!boxRef.current?.contains(target) &&
				!popupRef.current?.contains(target)
			)
				setOpen(false);
		};
		// Esc chỉ đóng lịch. Bắt ở pha capture và chặn lan tiếp, để hộp thoại
		// chứa ô ngày (ví dụ phiếu cước đang nhập) không đóng theo và mất dữ liệu.
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			setOpen(false);
		};
		document.addEventListener("mousedown", close);
		document.addEventListener("keydown", closeOnEscape, true);
		return () => {
			document.removeEventListener("mousedown", close);
			document.removeEventListener("keydown", closeOnEscape, true);
		};
	}, [open]);
	const year = view.getFullYear(),
		month = view.getMonth();
	const choose = (next: string) => {
		onChange(next);
		setText(display(next));
		setOpen(false);
	};
	const commit = () => {
		if (!text.trim()) {
			onChange("");
			return;
		}
		const next = parse(text);
		if (next) onChange(next);
		else setText(display(value));
	};
	const openPicker = () => {
		if (disabled) return;
		const [year, month] = (parse(text) || value || today())
			.split("-")
			.map(Number);
		setView(new Date(year, month - 1, 1));
		setMonthMode(false);
		setOpen(true);
	};
	const offset = (new Date(year, month, 1).getDay() + 6) % 7;
	const grid = [
		...Array.from({ length: offset }, (_, index) => index - offset),
		...Array.from(
			{ length: new Date(year, month + 1, 0).getDate() },
			(_, index) => index + 1,
		),
	];
	return (
		<>
			<span ref={boxRef} className="datebox manage-date">
				<input
					id={id}
					className="date-text"
					inputMode="numeric"
					value={text}
					placeholder="dd/mm/yyyy"
					aria-label={ariaLabel}
					disabled={disabled}
					onChange={(event) => setText(event.target.value)}
					onBlur={commit}
					onKeyDown={(event) => event.key === "Enter" && commit()}
				/>
				<button
					className="datepick"
					type="button"
					title="Chọn ngày"
					disabled={disabled}
					onClick={openPicker}
				>
					<CalendarDays />
				</button>
			</span>
			{open &&
				createPortal(
					<div
						ref={popupRef}
						className="vn-date-picker"
						style={{ ...position, zIndex: 1600 }}
						role="dialog"
						aria-label="Chọn ngày"
					>
						{monthMode ? (
							<>
								<div className="vn-date-head">
									<button
										type="button"
										onClick={() => setView(new Date(year - 1, month, 1))}
									>
										‹
									</button>
									<button
										className="vn-date-title"
										type="button"
										onClick={() => setMonthMode(false)}
									>
										Chọn tháng/năm
									</button>
									<button
										type="button"
										onClick={() => setView(new Date(year + 1, month, 1))}
									>
										›
									</button>
								</div>
								<div className="vn-year-row">
									<button
										type="button"
										onClick={() => setView(new Date(year - 1, month, 1))}
									>
										-
									</button>
									<input
										aria-label="Năm"
										type="number"
										value={year}
										onChange={(event) =>
											setView(
												new Date(Number(event.target.value) || year, month, 1),
											)
										}
									/>
									<button
										type="button"
										onClick={() => setView(new Date(year + 1, month, 1))}
									>
										+
									</button>
								</div>
								<div className="vn-month-grid">
									{months.map((name, index) => (
										<button
											type="button"
											className={index === month ? "selected" : ""}
											key={name}
											onClick={() => {
												setView(new Date(year, index, 1));
												setMonthMode(false);
											}}
										>
											{name}
										</button>
									))}
								</div>
							</>
						) : (
							<>
								<div className="vn-date-head">
									<button
										type="button"
										onClick={() => setView(new Date(year, month - 1, 1))}
									>
										‹
									</button>
									<button
										className="vn-date-title"
										type="button"
										onClick={() => setMonthMode(true)}
									>
										{months[month]} {year}
									</button>
									<button
										type="button"
										onClick={() => setView(new Date(year, month + 1, 1))}
									>
										›
									</button>
								</div>
								<div className="vn-date-days">
									{days.map((day) => (
										<span key={day}>{day}</span>
									))}
								</div>
								<div className="vn-date-grid">
									{grid.map((day) =>
										day <= 0 ? (
											<button
												type="button"
												className="blank"
												tabIndex={-1}
												key={day}
											/>
										) : (
											<button
												type="button"
												className={`${iso(year, month + 1, day) === value ? "selected" : ""} ${iso(year, month + 1, day) === today() ? "today" : ""}`}
												key={day}
												onClick={() => choose(iso(year, month + 1, day))}
											>
												{day}
											</button>
										),
									)}
								</div>
							</>
						)}
						<div className="vn-date-foot">
							<button type="button" onClick={() => choose(today())}>
								Hôm nay
							</button>
							<button type="button" onClick={() => setOpen(false)}>
								Đóng
							</button>
						</div>
					</div>,
					document.body,
				)}
		</>
	);
}
