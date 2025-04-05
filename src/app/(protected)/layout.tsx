import { redirect } from "next/navigation";
import { auth } from "../lib/auth";
import { Header } from "@/components/header";

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }
  return (
    <div className="container mx-auto max-w-8xl p-4">
      <Header />
      {children}
    </div>
  );
}
