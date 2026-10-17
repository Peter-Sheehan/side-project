import type { ComponentProps } from "react"
import { Link, useLocation } from "react-router"
import {
  Bookmark,
  ChevronsUpDown,
  FolderGit2,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Settings,
  type LucideIcon,
} from "lucide-react"

import { initials } from "@/lib/avatar"
import { useAuth } from "@/lib/auth-context"
import { Avatar, AvatarFallback, AvatarImage } from "@/shadcn/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shadcn/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/shadcn/components/ui/sidebar"

interface NavItem {
  title: string
  href: string
  icon: LucideIcon
}

const navItems: readonly NavItem[] = [
  { title: "Dashboard", href: "/landing", icon: LayoutDashboard },
  { title: "Repositories", href: "/repositories", icon: FolderGit2 },
  { title: "Jobs", href: "/jobs", icon: ListChecks },
  { title: "Saved", href: "/saved", icon: Bookmark },
]

function NavUser() {
  const { session, signOut } = useAuth()
  const name = session?.user.name ?? ""
  const email = session?.user.email ?? ""
  const image = session?.user.image ?? undefined

  const identity = (
    <>
      <Avatar className="size-8 rounded-lg">
        <AvatarImage src={image} alt="" className="rounded-lg" />
        <AvatarFallback className="rounded-lg">{initials(name, email)}</AvatarFallback>
      </Avatar>
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{name || email}</span>
        {name && <span className="truncate text-xs text-muted-foreground">{email}</span>}
      </div>
    </>
  )

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              />
            }
          >
            {identity}
            <ChevronsUpDown className="ml-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56"
            side="right"
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex items-center gap-2 p-1 font-normal">
                {identity}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link to="/settings" />}>
              <Settings />
              Account settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={signOut}>
              <LogOut />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

export function AppSidebar({
  productName = "SideProject",
  ...props
}: ComponentProps<typeof Sidebar> & { productName?: string }) {
  const { pathname } = useLocation()

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link to="/landing" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary font-semibold text-sidebar-primary-foreground">
                {productName.charAt(0)}
              </div>
              <span className="truncate font-semibold">{productName}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarMenu>
            {navItems.map(({ title, href, icon: Icon }) => (
              <SidebarMenuItem key={href}>
                <SidebarMenuButton
                  tooltip={title}
                  isActive={pathname === href}
                  render={<Link to={href} />}
                >
                  <Icon />
                  <span>{title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <NavUser />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
