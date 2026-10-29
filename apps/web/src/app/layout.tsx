import type { CSSProperties, ReactNode } from 'react'
import type { Metadata } from 'next'
import './globals.css'
import { AuthProvider } from '@/components/auth/auth-provider'
import { ThemeProvider } from '@/components/theme-provider'
import { brand } from '@/config/brand'

export const metadata: Metadata = {
  title: {
    default: brand.name,
    template: `%s · ${brand.shortName}`,
  },
  description: brand.description,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  const themeStyle = {
    '--primary': brand.theme.primary,
    '--primary-foreground': brand.theme.primaryForeground,
    '--ring': brand.theme.ring,
  } as CSSProperties

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body style={themeStyle}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
