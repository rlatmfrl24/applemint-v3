import AuthButton from "../login/auth-button";
import { MainDrawer, NavMenu } from "../nav-menu";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
      {children}
    </>
  );
}
