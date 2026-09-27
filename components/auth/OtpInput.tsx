"use client";

import { ClipboardEvent, KeyboardEvent, useRef } from "react";
import { cn } from "@/lib/utils";

type OtpInputProps = {
  value: string[];
  disabled?: boolean;
  error?: boolean;
  onChange: (value: string[]) => void;
};

export function OtpInput({ value, disabled, error, onChange }: OtpInputProps) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const updateDigit = (index: number, nextValue: string) => {
    const digit = nextValue.replace(/\D/g, "").slice(0, 1);
    const nextOtp = [...value];
    nextOtp[index] = digit;
    onChange(nextOtp);

    if (digit && index < value.length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !value[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }

    if (event.key === "ArrowLeft" && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }

    if (event.key === "ArrowRight" && index < value.length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const pastedDigits = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, value.length);
    const nextOtp = pastedDigits.split("").concat(Array(value.length).fill("")).slice(0, value.length);
    onChange(nextOtp);
    inputRefs.current[Math.min(pastedDigits.length, value.length - 1)]?.focus();
  };

  return (
    <div className="flex justify-center gap-2 sm:gap-3" onPaste={handlePaste}>
      {value.map((digit, index) => (
        <input
          key={index}
          ref={(element) => {
            inputRefs.current[index] = element;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          disabled={disabled}
          aria-label={`OTP digit ${index + 1}`}
          aria-invalid={error}
          autoFocus={index === 0}
          onChange={(event) => updateDigit(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          className={cn(
            "h-14 w-11 rounded-[10px] border bg-white text-center text-2xl font-bold text-slate-950 shadow-sm outline-none transition sm:h-16 sm:w-12",
            "focus:border-[#1E88E5] focus:ring-4 focus:ring-[#1E88E5]/15 disabled:cursor-not-allowed disabled:bg-slate-50",
            error ? "border-red-400 focus:border-red-500 focus:ring-red-100" : "border-slate-200"
          )}
        />
      ))}
    </div>
  );
}
