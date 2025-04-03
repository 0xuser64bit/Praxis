import { Header } from "@/components/header";

export default function Home() {
  return (
    <div className="container mx-auto max-w-8xl p-4">
      <Header />
      <main className="flex flex-col items-center justify-center gap-4 py-4">
        <h1 className="text-4xl font-bold">Welcome to Better Wallet</h1>
      </main>
    </div>
  );
}
