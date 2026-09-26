import type { Metadata } from "next";
import Link from "next/link";
import { Geist } from "next/font/google";
import { getCurrentUser } from "@/lib/auth";
import { logout } from "@/app/actions/auth";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "WeekBite — weekly food offers near you",
  description: "Lunch menus, grocery deals and fast food offers around the places you spend your week, summarized every week. No account needed to look around.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <header className="border-b border-line bg-card/70 backdrop-blur sticky top-0 z-10">
          <nav className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
            <Link href={user ? "/dashboard" : "/"} className="text-lg font-bold tracking-tight">
              <span className="text-brand">Week</span>Bite
            </Link>
            <div className="ml-auto flex items-center gap-4 text-sm">
              {user ? (
                <>
                  <Link href="/dashboard" className="hover:text-brand">This week</Link>
                  <Link href="/locations" className="hover:text-brand">My locations</Link>
                  <form action={logout}>
                    <button className="text-muted hover:text-brand">Log out</button>
                  </form>
                </>
              ) : (
                <>
                  <Link href="/login" className="hover:text-brand">Log in</Link>
                  <Link href="/signup" className="btn py-1.5">Sign up</Link>
                </>
              )}
            </div>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-line py-4 text-center text-xs text-muted">
          Offers are collected automatically from public websites and may be incomplete — always check with the restaurant or store.
        </footer>
      </body>
    </html>
  );
}
