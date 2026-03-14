import { AuthProvider } from "@/lib/auth-context";
import { RedirectIfUnauth } from "@/components/auth/redirect-if-unauth";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthProvider>
      <RedirectIfUnauth>{children}</RedirectIfUnauth>
    </AuthProvider>
  );
}
