"use client";

import { MenuIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button, buttonVariants } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";

const MenuList = [
	{
		name: "Main",
		href: "/main",
	},
	{
		name: "Quick",
		href: "/main/quick",
	},
	{
		name: "Trash",
		href: "/main/trash",
	},
	{
		name: "Bookmark",
		href: "/main/bookmarks",
	},
	{
		name: "Setting",
		href: "/main/setting",
	},
];

export const NavMenu = () => {
	const pathname = usePathname() ?? "/";

	function isActive(href: string) {
		return pathname === href || (href !== "/main" && pathname.startsWith(`${href}/`));
	}

	const activeMenu = MenuList.find((item) => isActive(item.href));

	return (
		<>
			<h3 className="block md:hidden">{activeMenu?.name ?? "Main"}</h3>
			<nav aria-label="Main navigation" className="hidden w-fit md:flex">
				<ul className="flex list-none items-center justify-center space-x-1">
					{MenuList.map((item) => (
						<li key={item.href}>
							<Button asChild variant={isActive(item.href) ? "secondary" : "ghost"}>
								<Link aria-current={isActive(item.href) ? "page" : undefined} href={item.href}>
									{item.name}
								</Link>
							</Button>
						</li>
					))}
				</ul>
			</nav>
		</>
	);
};

export const MainDrawer = () => {
	return (
		<Drawer setBackgroundColorOnScale={false}>
			<DrawerTrigger asChild>
				<MenuIcon className="cursor-pointer md:hidden" />
			</DrawerTrigger>
			<DrawerContent>
				<div className="container mx-auto flex w-full flex-col gap-2 p-4">
					{MenuList.map((item) => (
						<DrawerClose asChild key={item.href}>
							<Link
								className={buttonVariants({ variant: "ghost", className: "text-xl" })}
								href={item.href}
							>
								{item.name}
							</Link>
						</DrawerClose>
					))}
				</div>
			</DrawerContent>
		</Drawer>
	);
};
