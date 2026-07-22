import { Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './routes/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { RootRedirect } from './pages/RootRedirect'
import { DashboardPage } from './pages/DashboardPage'
import { OverviewPage } from './pages/overview/OverviewPage'
import { CrmPage } from './pages/crm/CrmPage'
import { ProspeccaoPage } from './pages/prospeccao/ProspeccaoPage'
import { BroadcastPage } from './pages/broadcast/BroadcastPage'
import { AgentePage } from './pages/agente/AgentePage'
import { FinanceiroPage } from './pages/financeiro/FinanceiroPage'
import { CerebroPage } from './pages/cerebro/CerebroPage'
import { HubPage } from './pages/hub/HubPage'
import { SettingsPage } from './pages/settings/SettingsPage'

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <RootRedirect />
          </ProtectedRoute>
        }
      />
      <Route
        path="/empresas"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/visao-geral/:tenantId"
        element={
          <ProtectedRoute>
            <OverviewPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/crm/:tenantId"
        element={
          <ProtectedRoute>
            <CrmPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/prospeccao/:tenantId"
        element={
          <ProtectedRoute>
            <ProspeccaoPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/disparos/:tenantId"
        element={
          <ProtectedRoute>
            <BroadcastPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/agente/:tenantId"
        element={
          <ProtectedRoute>
            <AgentePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/financeiro/:tenantId"
        element={
          <ProtectedRoute>
            <FinanceiroPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/hub/:tenantId"
        element={
          <ProtectedRoute>
            <HubPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/configuracoes/:tenantId"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/cerebro"
        element={
          <ProtectedRoute>
            <CerebroPage />
          </ProtectedRoute>
        }
      />
    </Routes>
  )
}

export default App
