import { useActionState, useRef, useState, type ChangeEvent } from "react";
import { LoaderCircle } from "lucide-react";

import { AppLayout } from "../components/app-layout";
import { postAuth } from "../lib/auth-client";
import { useAuth } from "../lib/auth-context";
import { initials, resizeAvatar } from "../lib/avatar";
import {
    PASSWORD_MAX_LENGTH,
    PASSWORD_REQUIREMENTS,
    toAccountErrorMessage,
    validatePassword,
} from "../lib/sign-up-validation";
import { Avatar, AvatarFallback, AvatarImage } from "../shadcn/components/ui/avatar";
import { Button } from "../shadcn/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "../shadcn/components/ui/card";
import { Input } from "../shadcn/components/ui/input";
import { Label } from "../shadcn/components/ui/label";

type Status = { kind: "error" | "success"; message: string } | null;

function StatusMessage({ status }: { status: Status }) {
    if (!status) return null;
    return (
        <p
            role={status.kind === "error" ? "alert" : "status"}
            className={
                status.kind === "error"
                    ? "text-sm text-destructive"
                    : "text-sm text-muted-foreground"
            }
        >
            {status.message}
        </p>
    );
}

function ProfileCard() {
    const { session, refreshSession } = useAuth();
    const name = session?.user.name ?? "";
    const email = session?.user.email ?? "";
    const image = session?.user.image ?? undefined;

    const fileInput = useRef<HTMLInputElement>(null);
    const [avatarStatus, setAvatarStatus] = useState<Status>(null);
    const [avatarBusy, setAvatarBusy] = useState(false);

    async function saveImage(next: string | null) {
        setAvatarBusy(true);
        setAvatarStatus(null);
        try {
            const error = await postAuth("/update-user", { image: next });
            if (error) throw new Error(toAccountErrorMessage(error));
            await refreshSession();
            setAvatarStatus({
                kind: "success",
                message: next ? "Photo updated." : "Photo removed.",
            });
        } catch (err) {
            setAvatarStatus({
                kind: "error",
                message: err instanceof Error ? err.message : "Couldn't update your photo.",
            });
        } finally {
            setAvatarBusy(false);
        }
    }

    async function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        try {
            await saveImage(await resizeAvatar(file));
        } catch (err) {
            setAvatarStatus({
                kind: "error",
                message: err instanceof Error ? err.message : "Couldn't read that image.",
            });
        }
    }

    const [nameStatus, saveName, savingName] = useActionState(
        async (_prev: Status, data: FormData): Promise<Status> => {
            const next = String(data.get("name") ?? "").trim();
            if (!next) return { kind: "error", message: "Enter your name." };
            const error = await postAuth("/update-user", { name: next });
            if (error) return { kind: "error", message: toAccountErrorMessage(error) };
            await refreshSession();
            return { kind: "success", message: "Name saved." };
        },
        null,
    );

    return (
        <Card>
            <CardHeader>
                <CardTitle>Profile</CardTitle>
                <CardDescription>Your name and photo.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
                <div className="flex items-center gap-4">
                    <Avatar className="size-16">
                        <AvatarImage src={image} alt="" />
                        <AvatarFallback className="text-lg">{initials(name, email)}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col gap-2">
                        <div className="flex gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={avatarBusy}
                                onClick={() => fileInput.current?.click()}
                            >
                                {avatarBusy && <LoaderCircle className="animate-spin" aria-hidden />}
                                Upload photo
                            </Button>
                            {image && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={avatarBusy}
                                    onClick={() => saveImage(null)}
                                >
                                    Remove
                                </Button>
                            )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            PNG, JPEG or WebP. It's cropped to a square.
                        </p>
                    </div>
                    <input
                        ref={fileInput}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        hidden
                        onChange={onFileChosen}
                    />
                </div>
                <StatusMessage status={avatarStatus} />

                <form action={saveName} className="flex flex-col gap-3" noValidate>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="settings-name">Name</Label>
                        <Input
                            id="settings-name"
                            name="name"
                            autoComplete="name"
                            defaultValue={name}
                            disabled={savingName}
                        />
                    </div>
                    <div className="flex items-center gap-3">
                        <Button type="submit" disabled={savingName}>
                            {savingName && <LoaderCircle className="animate-spin" aria-hidden />}
                            Save name
                        </Button>
                        <StatusMessage status={nameStatus} />
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}

function PasswordCard() {
    const { session } = useAuth();

    const [status, changePassword, pending] = useActionState(
        async (_prev: Status, data: FormData): Promise<Status> => {
            const currentPassword = String(data.get("currentPassword") ?? "");
            const newPassword = String(data.get("newPassword") ?? "");
            if (!currentPassword) return { kind: "error", message: "Enter your current password." };
            const problem = validatePassword(newPassword);
            if (problem) return { kind: "error", message: problem };

            const error = await postAuth("/change-password", {
                currentPassword,
                newPassword,
                revokeOtherSessions: true,
            });
            if (error) return { kind: "error", message: toAccountErrorMessage(error) };
            return {
                kind: "success",
                message: "Password changed. Any other devices have been signed out.",
            };
        },
        null,
    );

    return (
        <Card>
            <CardHeader>
                <CardTitle>Password</CardTitle>
                <CardDescription>{PASSWORD_REQUIREMENTS}</CardDescription>
            </CardHeader>
            <CardContent>
                <form action={changePassword} className="flex flex-col gap-3" noValidate>
                    {/* Hidden username so password managers update the right login. */}
                    <input
                        type="email"
                        name="username"
                        autoComplete="username"
                        value={session?.user.email ?? ""}
                        readOnly
                        hidden
                    />
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="settings-current-password">Current password</Label>
                        <Input
                            id="settings-current-password"
                            name="currentPassword"
                            type="password"
                            autoComplete="current-password"
                            disabled={pending}
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="settings-new-password">New password</Label>
                        <Input
                            id="settings-new-password"
                            name="newPassword"
                            type="password"
                            autoComplete="new-password"
                            maxLength={PASSWORD_MAX_LENGTH}
                            disabled={pending}
                        />
                    </div>
                    <div className="flex items-center gap-3">
                        <Button type="submit" disabled={pending}>
                            {pending && <LoaderCircle className="animate-spin" aria-hidden />}
                            Change password
                        </Button>
                        <StatusMessage status={status} />
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}

export default function SettingsPage() {
    return (
        <AppLayout section="Account" title="Settings">
            <div className="grid max-w-2xl gap-4">
                <ProfileCard />
                <PasswordCard />
            </div>
        </AppLayout>
    );
}
