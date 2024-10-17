"use client";

import { Button } from "@/components/ui/button";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "@/components/ui/navigation-menu";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const NavMenu = () => {
  const pathname = usePathname() ?? "/";

  return (
    <NavigationMenu className="w-fit">
      <NavigationMenuList>
        <NavigationMenuItem>
          <Link href="/" legacyBehavior passHref>
            <Button variant={pathname === "/" ? "secondary" : "ghost"}>
              <NavigationMenuLink>Main</NavigationMenuLink>
            </Button>
          </Link>
        </NavigationMenuItem>
        <NavigationMenuItem>
          <Link href="/quick" legacyBehavior passHref>
            <Button variant={pathname === "/quick" ? "secondary" : "ghost"}>
              <NavigationMenuLink>Quick</NavigationMenuLink>
            </Button>
          </Link>
        </NavigationMenuItem>
      </NavigationMenuList>
    </NavigationMenu>
  );
};
