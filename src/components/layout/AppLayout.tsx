import { ArrowUpRight, Leaf, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'
import { navigation, type PageId } from '@/app/navigation'
import { cn } from '@/lib/utils'

interface AppLayoutProps {
  currentPage: PageId
  children: ReactNode
}

export function AppLayout({ currentPage, children }: AppLayoutProps) {
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
      >Перейти к содержимому</a>
      <aside className="sidebar" aria-label="Основная панель">
        <a className="brand" href="#today" aria-label="Задачник — на страницу Сегодня">
          <span className="brand-mark"><Leaf size={24} strokeWidth={1.65} aria-hidden="true" /></span>
          <span>Задачник<span className="brand-caption">В своём ритме</span></span>
        </a>

        <div className="nav-caption">ЛИЧНОЕ ПРОСТРАНСТВО</div>
        <nav className="main-navigation" aria-label="Разделы приложения">
          {navigation.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className={cn('navigation-link', currentPage === id && 'is-active')}
              aria-current={currentPage === id ? 'page' : undefined}
            >
              <Icon size={19} strokeWidth={1.7} aria-hidden="true" />
              <span>{label}</span>
              {currentPage === id && <span className="navigation-dot" aria-hidden="true" />}
            </a>
          ))}
        </nav>

        <div className="sidebar-note">
          <span className="sidebar-note-icon"><Leaf size={20} aria-hidden="true" /></span>
          <p>Большое начинается<br />с маленьких шагов.</p>
          <span>Один день за раз.</span>
          <ArrowUpRight className="sidebar-note-arrow" size={20} aria-hidden="true" />
        </div>

        <div className="local-storage-note">
          <ShieldCheck size={17} strokeWidth={1.7} aria-hidden="true" />
          <span>Данные в вашем браузере</span>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <span>Моё пространство <span className="breadcrumb-slash">/</span> <strong>{navigation.find((page) => page.id === currentPage)?.label}</strong></span>
          <span className="local-badge"><span aria-hidden="true" />Локальное хранение</span>
        </header>
        <main id="main-content" className="main-content" tabIndex={-1}>{children}</main>
        <footer className="page-footer"><Leaf size={14} aria-hidden="true" />Меньше спешки. Больше внимания к себе.</footer>
      </div>
    </div>
  )
}
