import type { Metadata } from 'next'
import { DashboardView } from './dashboard-view'

export const metadata: Metadata = {
  title: '总览',
}

export default function DashboardPage() {
  return <DashboardView />
}
