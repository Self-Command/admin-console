import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import './globals.css'
import { AuthProvider } from '@/components/auth/auth-provider'
import { BrandProvider } from '@/components/brand/brand-provider'
import { WorkspaceProvider } from '@/components/layout/workspace-provider'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { getPublicSettings, resolveFaviconUrl } from '@/lib/runtime/public-settings'
import { buildThemeStyleTag } from '@/lib/runtime/theme'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { branding } = await getPublicSettings()
  const favicon = resolveFaviconUrl(branding)
  return {
    title: {
      default: branding.name,
      template: `%s · ${branding.shortName}`,
    },
    description: branding.description,
    ...(favicon ? { icons: { icon: favicon } } : {}),
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const settings = await getPublicSettings()

  return (
    <html
      lang="zh-CN"
      data-density={settings.theme.density}
      suppressHydrationWarning
    >
      <body>
        <style dangerouslySetInnerHTML={{ __html: buildThemeStyleTag(settings.theme) }} />
        <ThemeProvider
          attribute="class"
          defaultTheme={settings.theme.defaultMode}
          enableSystem
          enableColorScheme
          disableTransitionOnChange
        >
          <BrandProvider settings={settings}>
            <AuthProvider>
              <WorkspaceProvider>{children}</WorkspaceProvider>
              <Toaster />
            </AuthProvider>
          </BrandProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
