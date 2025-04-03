import { redirect } from "next/navigation";
import { auth } from "../lib/auth";

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  if (!session?.user) {
    redirect("/");
  }
  return <>{children}</>;
}
