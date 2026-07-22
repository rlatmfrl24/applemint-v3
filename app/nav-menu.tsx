"use client";

import { MenuIcon } from "lucide-react";
import { usePathname } from "next/navigation";

import { Button, buttonVariants } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerTrigger } from "@/components/ui/drawer";

const MenuList = [
	{
		name: "Main",
		href: "/main",
		type: "internal",
	},
	{
		name: "Quick",
		href: "/main/quick",
		type: "internal",
	},
	{
		name: "Trash",
		href: "/main/trash",
		type: "internal",
	},
	{
		name: "Setting",
		href: "/main/setting",
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

	function isActive(href: string) {
		return pathname === href || (href !== "/main" && pathname.startsWith(`${href}/`));
	}

	function getActiveMenu(pathname: string) {
		return MenuList.find(
			(item) => item.type === "internal" && (item.href === pathname || isActive(item.href))
		);
	}

	return (
		<>
			<h3 className="block md:hidden">{getActiveMenu(pathname)?.name ?? "Main"}</h3>
			<nav aria-label="Main navigation" className="hidden w-fit md:flex">
				<ul className="flex list-none items-center justify-center space-x-1">
					{MenuList.map((item) => (
						<li key={item.href}>
							<Button asChild variant={isActive(item.href) ? "secondary" : "ghost"}>
								<a
									aria-current={isActive(item.href) ? "page" : undefined}
									href={item.href}
									target={item.type === "external" ? "_blank" : undefined}
									rel={item.type === "external" ? "noreferrer" : undefined}
								>
									{item.name} {item.type === "external" ? " ↗" : ""}
								</a>
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
				<MenuIcon className="ml-3 cursor-pointer md:hidden" />
			</DrawerTrigger>
			<DrawerContent>
				<div className="container mx-auto flex w-full flex-col gap-2 p-4">
					{MenuList.map((item) => (
						<DrawerClose asChild key={item.href}>
							<a
								className={buttonVariants({ variant: "ghost", className: "text-xl" })}
								href={item.href}
								target={item.type === "external" ? "_blank" : undefined}
								rel={item.type === "external" ? "noreferrer" : undefined}
							>
								{item.name} {item.type === "external" ? " ↗" : ""}
							</a>
						</DrawerClose>
					))}
				</div>
			</DrawerContent>
		</Drawer>
	);
};
