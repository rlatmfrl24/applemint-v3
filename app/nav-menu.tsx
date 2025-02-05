"use client";

import { MenuIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "@/components/ui/navigation-menu";
import { useUserStore } from "@/store/user.store";

const MenuList = [
  {
    name: "Main",
    href: "/",
    type: "internal",
  },
  {
    name: "Quick",
    href: "/quick",
    type: "internal",
  },
  {
    name: "Trash",
    href: "/trash",
    type: "internal",
  },
  {
    name: "Raindrop",
    href: "https://app.raindrop.io/my/0",
    type: "external",
  },
];

export const NavMenu = () => {
  const pathname = usePathname() ?? "/";
  const isUserLoggedIn = useUserStore().isUserLoggedIn;

  return (
    <>
      {isUserLoggedIn && (
        <NavigationMenu className="w-fit hidden md:flex">
          <NavigationMenuList>
            {MenuList.map((item) => (
              <NavigationMenuItem key={item.href}>
                <Link
                  href={item.href}
                  passHref
                  target={item.type === "external" ? "_blank" : ""}
                >
                  <Button
                    variant={pathname === item.href ? "secondary" : "ghost"}
                  >
                    <NavigationMenuLink>
                      {item.name} {item.type === "external" ? " ↗" : ""}
                    </NavigationMenuLink>
                  </Button>
                </Link>
              </NavigationMenuItem>
            ))}
          </NavigationMenuList>
        </NavigationMenu>
      )}
    </>
  );
};

export const MainDrawer = () => {
  const router = useRouter();

  return (
    <Drawer setBackgroundColorOnScale={false}>
      <DrawerTrigger asChild>
        <MenuIcon className="ml-3 cursor-pointer md:hidden" />
      </DrawerTrigger>
      <DrawerContent>
        <div className="mx-auto w-full container flex flex-col gap-2 p-4">
          {MenuList.map((item) => (
            <DrawerClose asChild key={item.href}>
              <Button
                key={item.href}
                variant={"ghost"}
                className="text-xl"
                onClick={() => router.push(item.href)}
              >
                {item.name}
              </Button>
            </DrawerClose>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
};
