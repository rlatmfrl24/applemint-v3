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

const MenuList = [
  {
    name: "Main",
    href: "/",
  },
  {
    name: "Quick",
    href: "/quick",
  },
];

export const NavMenu = () => {
  const pathname = usePathname() ?? "/";

  return (
    <NavigationMenu className="w-fit hidden md:flex">
      <NavigationMenuList>
        {MenuList.map((item) => (
          <NavigationMenuItem key={item.href}>
            <Link href={item.href} legacyBehavior passHref>
              <Button variant={pathname === item.href ? "secondary" : "ghost"}>
                <NavigationMenuLink>{item.name}</NavigationMenuLink>
              </Button>
            </Link>
          </NavigationMenuItem>
        ))}
      </NavigationMenuList>
    </NavigationMenu>
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
