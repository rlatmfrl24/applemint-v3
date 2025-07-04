import { createClient } from "@/utils/supabase/server";
import AuthButton from "../login/auth-button";
import { MainDrawer, NavMenu } from "../nav-menu";
import { redirect } from "next/navigation";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <>
      <nav className="w-full flex justify-center border-b border-b-foreground/10">
        <div className="w-full container flex justify-between items-center p-3 gap-2">
          <div className="flex gap-6 items-center">
            <MainDrawer />
            <h3 className="hidden md:flex">Applemint</h3>
            <NavMenu />
          </div>
          <AuthButton />
        </div>
      </nav>
      <div className="flex-1 w-full flex flex-col items-center container p-3">
        {children}
      </div>
    </>
  );
}
