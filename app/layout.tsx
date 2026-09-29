import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InsightFlow AI",
  description: "CSV profiling and a closed Pandas analysis catalog.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
