import React from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * כפתור חזרה אחיד (אייקון בלבד). בנייד החזרה נמצאת בסרגל העליון (TopBar),
 * לכן כאן הוא מוצג במחשב בלבד — כדי שלא יהיו שני כפתורי חזרה באותו מסך.
 */
export default function BackButton({ to, label = "חזרה", className }) {
  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      className={cn(
        "hidden lg:inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      <ArrowRight className="h-5 w-5" aria-hidden="true" />
    </Link>
  );
}
