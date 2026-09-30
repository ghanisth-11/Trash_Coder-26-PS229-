'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  Archive,
  ArrowLeft,
  BarChart3,
  Camera,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Home,
  IndianRupee,
  Leaf,
  LoaderCircle,
  LogOut,
  MapPin,
  Menu,
  PackagePlus,
  Phone,
  Plus,
  Recycle,
  ScanLine,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Truck,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react';
import { can, mayPurchaseCollectorLot, roleHome } from '@/lib/permissions';
import { AppLanguage, translate } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/language-switcher';
import { TranslationProvider, useTranslation } from '@/lib/translation-context';
import { api } from '@/services/api';
import { getFirebaseAuth } from '@/lib/firebase';
import type { BackendProfile, ShopItem } from '@/services/api';
import type { MaterialCategory, UserRole } from '@/types/domain';

const Icon = ({ children }: { children: React.ReactNode }) => (
  <span className="icon-wrap" aria-hidden="true">
    {children}
  </span>
);
const title = (name: string, copy?: string, action?: React.ReactNode) => (
  <header className="page-heading">
    <div>
      <p className="eyebrow">Kabadiwala Connect</p>
      <h1>{name}</h1>
      {copy && <p>{copy}</p>}
    </div>
    {action}
  </header>
);
const EmptyState = ({
  title: label,
  copy,
  action,
}: {
  title: string;
  copy: string;
  action?: React.ReactNode;
}) => (
  <section className="empty-state">
    <div className="empty-art">
      <Recycle size={34} />
    </div>
    <h2>{label}</h2>
    <p>{copy}</p>
    {action}
  </section>
);
const Skeleton = () => (
  <div className="skeleton-grid" aria-label="Loading">
    <i />
    <i />
    <i />
  </div>
);
const Button = ({
  children,
  kind = 'primary',
  onClick,
  disabled,
  type = 'button',
}: {
  children: React.ReactNode;
  kind?: 'primary' | 'secondary' | 'quiet';
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) => (
  <button type={type} className={`button ${kind}`} onClick={onClick} disabled={disabled}>
    {children}
  </button>
);
const StatusBadge = ({ status }: { status: string }) => (
  <span className="status">
    {status
      .replaceAll('_', ' ')
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())}
  </span>
);

function Logo() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Recycle size={19} />
      </span>
      <span>
        Kabadiwala <b>Connect</b>
      </span>
    </div>
  );
}
function frontendRole(profile: BackendProfile): UserRole | null {
  if (profile.role === 'kabadiwala') return 'KABADIWALA';
  if (profile.role === 'middleman') return 'MIDDLEMAN';
  if (profile.role === 'recycler') return 'RECYCLER';
  if (profile.role === 'admin') return 'ADMIN';
  return null;
}

function nameFromEmail(email: string) {
  const localPart = email.trim().split('@')[0] ?? '';
  const name = localPart
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
  return name || 'Kabadiwala user';
}

function AuthPage({
  language,
  onLanguageChange,
  onAuthenticated,
}: {
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  onAuthenticated: (profile: BackendProfile) => void;
}) {
  const router = useRouter();
  const t = (key: string) => translate(language, key);
  const [selected, setSelected] = useState<UserRole>('KABADIWALA');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'sign-in' | 'register' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finish = (profile: BackendProfile) => {
    const role = frontendRole(profile);
    if (!role) {
      setError('This is a staff account. Use the backend admin API for staff operations.');
      return;
    }
    onAuthenticated(profile);
    router.push(roleHome[role]);
  };
  const messageFor = (reason: unknown) =>
    reason instanceof Error ? reason.message : 'Unable to authenticate. Please try again.';
  const signIn = async () => {
    setError(null);
    setBusy('sign-in');
    try {
      await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
      const { profile } = await api.verifyToken();
      if (!profile) {
        await signOut(getFirebaseAuth());
        throw new Error('This Firebase account has no Kabadiwala Connect profile yet. Create an account first.');
      }
      finish(profile);
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setBusy(null);
    }
  };
  const register = async () => {
    setError(null);
    setBusy('register');
    try {
      await createUserWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
      const profile = await api.createProfile({
        role: selected === 'KABADIWALA' ? 'kabadiwala' : selected === 'MIDDLEMAN' ? 'middleman' : 'recycler',
        name: nameFromEmail(email),
      });
      finish(profile);
    } catch (reason) {
      await signOut(getFirebaseAuth()).catch(() => undefined);
      setError(messageFor(reason));
    } finally {
      setBusy(null);
    }
  };
  return (
    <main className="auth-layout">
      <section className="auth-visual">
        <div className="auth-copy">
          <Logo />
          <h1>{t('Every piece of scrap has a better next stop.')}</h1>
          <p>{t("Connect local collection to India's recycling network.")}</p>
        </div>
        <img
          src="/images/collector-splash.png"
          alt="Scrap collector transporting sorted recyclable material"
        />
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-topbar">
            <Logo />
            <LanguageSwitcher language={language} onChange={onLanguageChange} compact />
          </div>
          <h1>{t('How will you use Kabadiwala Connect?')}</h1>
          <p>{t('Sign in to an existing account, or choose a role before creating a new account.')}</p>
          <div className="role-options">
            {(['KABADIWALA', 'MIDDLEMAN', 'RECYCLER'] as UserRole[]).map((item) => (
              <button
                type="button"
                onClick={() => setSelected(item)}
                className={selected === item ? 'role-choice selected' : 'role-choice'}
                key={item}
              >
                <Icon>{item === 'KABADIWALA' ? <Truck /> : item === 'MIDDLEMAN' ? <Archive /> : <Recycle />}</Icon>
                <span>
                  <b>{item === 'KABADIWALA' ? t('Collector') : item === 'MIDDLEMAN' ? t('Middle Man Aggregator') : t('Authorized Recyclers')}</b>
                  <small>{item === 'KABADIWALA' ? t('Sell collected scrap') : item === 'MIDDLEMAN' ? t('Buy, process and batch') : t('Buy ready materials')}</small>
                </span>
              </button>
            ))}
          </div>
          <label>Email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required /></label>
          <label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" minLength={6} required /></label>
          <p className="form-hint">Aggregator and recycler accounts require administrator verification before they can trade.</p>
          {error && <div className="inline-error" role="alert">{error}</div>}
          <div className="form-grid">
            <Button onClick={signIn} disabled={busy !== null}>{busy === 'sign-in' ? 'Signing in...' : 'Sign in'}</Button>
            <Button kind="secondary" onClick={register} disabled={busy !== null}>{busy === 'register' ? 'Creating...' : 'Create account'}</Button>
          </div>
        </div>
      </section>
    </main>
  );
}

const kabadiNav = (language: AppLanguage) => [
  { href: '/kabadiwala/home', label: translate(language, 'home'), icon: Home },
  { href: '/kabadiwala/pickups', label: translate(language, 'pickups'), icon: Truck },
  { href: '/kabadiwala/lots', label: translate(language, 'myLots'), icon: Archive },
  { href: '/kabadiwala/ledger', label: translate(language, 'ledger'), icon: WalletCards },
  { href: '/kabadiwala/profile', label: translate(language, 'profile'), icon: UserRound },
];
const buyerNav = (role: UserRole, language: AppLanguage) => [
  {
    href: role === 'MIDDLEMAN' ? '/middleman/dashboard' : '/recycler/dashboard',
    label: translate(language, 'Dashboard'),
    icon: Home,
  },
  {
    href: `/${role.toLowerCase()}/collector-shop`,
    label: translate(language, 'Collector Shop'),
    icon: ShoppingBag,
  },
  ...(role === 'MIDDLEMAN'
    ? [
        { href: '/middleman/inventory', label: translate(language, 'Inventory'), icon: Archive },
        {
          href: '/middleman/batches',
          label: translate(language, 'Category Lots'),
          icon: PackagePlus,
        },
      ]
    : [
        {
          href: '/recycler/middleman-shop',
          label: translate(language, 'Aggregator Shop'),
          icon: Recycle,
        },
        { href: '/recycler/orders', label: translate(language, 'Orders'), icon: ClipboardList },
      ]),
  {
    href: `/${role.toLowerCase()}/ledger`,
    label: translate(language, 'Ledger'),
    icon: WalletCards,
  },
  {
    href: `/${role.toLowerCase()}/profile`,
    label: translate(language, 'Profile'),
    icon: UserRound,
  },
];
const adminNav = (language: AppLanguage) => [
  { href: '/admin', label: translate(language, 'Admin dashboard'), icon: BarChart3 },
];

function AppShell({
  role,
  language,
  setLanguage,
  onLogout,
  children,
}: {
  role: UserRole;
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const t = (key: string) => translate(language, key);
  const nav =
    role === 'KABADIWALA'
      ? kabadiNav(language)
      : role === 'ADMIN'
        ? adminNav(language)
        : buyerNav(role, language);
  const [menu, setMenu] = useState(false);
  const active = (href: string) =>
    pathname === href ||
    (href !== `/${role.toLowerCase()}/dashboard` && pathname.startsWith(`${href}/`));
  return (
    <div className={`app-shell ${role.toLowerCase()}`}>
      <aside className="sidebar">
        <Logo />
        <nav>
          {nav.map((item) => (
            <button
              onClick={() => router.push(item.href)}
              className={active(item.href) ? 'nav-link active' : 'nav-link'}
              key={item.href}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <LanguageSwitcher language={language} onChange={setLanguage} />
          <button className="nav-link" onClick={onLogout}>
            <LogOut size={19} />
            <span>{t('Logout')}</span>
          </button>
        </div>
      </aside>
      <header className="mobile-top">
        <Logo />
        <div className="mobile-top-actions">
          <LanguageSwitcher language={language} onChange={setLanguage} compact />
          <button
            className="icon-button"
            aria-label={t('Open menu')}
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
        </div>
        {menu && (
          <div className="mobile-menu">
            {nav.map((item) => (
              <button
                key={item.href}
                onClick={() => {
                  router.push(item.href);
                  setMenu(false);
                }}
              >
                <item.icon size={18} />
                {item.label}
              </button>
            ))}
            <button onClick={onLogout}><LogOut size={18} />{t('Logout')}</button>
          </div>
        )}
      </header>
      <main className="app-content">{children}</main>
      {role === 'KABADIWALA' && (
        <nav className="bottom-nav">
          {nav.map((item) => (
            <button
              key={item.href}
              className={active(item.href) ? 'active' : ''}
              onClick={() => router.push(item.href)}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

function KabadiHome({ language }: { language: AppLanguage }) {
  const router = useRouter();
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  return (
    <>
      {title(`${t('greeting')} 👋`, t('homeIntro'))}
      <section className="sell-hero">
        <div>
          <span className="mini-label">{t('readyToSell')}</span>
          <h2>{t('sellHeadline')}</h2>
          <p>{t('sellScrap')}</p>
          <Button onClick={() => router.push('/kabadiwala/create-lot')}>
            {t('sellScrap')} <ChevronRight size={19} />
          </Button>
        </div>
        <Recycle size={116} strokeWidth={1.1} />
      </section>
      <section className="quick-grid">
        <button onClick={() => router.push('/kabadiwala/scan')} className="quick-card scan">
          <Icon>
            <ScanLine />
          </Icon>
          <b>{t('scanMaterial')}</b>
          <span>{t('scanHelper')}</span>
        </button>
        <button onClick={() => router.push('/kabadiwala/prices')} className="quick-card">
          <Icon>
            <IndianRupee />
          </Icon>
          <b>{t('checkPrice')}</b>
          <span>{t('priceHelper')}</span>
        </button>
        <button onClick={() => router.push('/kabadiwala/pickups')} className="quick-card">
          <Icon>
            <Truck />
          </Icon>
          <b>{t('pickupRequests')}</b>
          <span>{t('pickupHelper')}</span>
        </button>
      </section>
      <section className="activity-section">
        <div className="section-label">
          <h2>{t('recentActivity')}</h2>
        </div>
        <EmptyState title={t('noActivity')} copy={t('noActivityCopy')} />
      </section>
    </>
  );
}

const lotSchema = z.object({
  category: z.string().min(1, 'Choose a material'),
  weight: z.coerce.number().positive('Enter a valid weight'),
  unit: z.enum(['kg', 'piece']),
  expectedPrice: z.coerce.number().nonnegative('Enter an expected price'),
  location: z.string().min(2, 'Enter your area'),
});
const directBulkLotSchema = z.object({
  category: z.enum(
    ['Paper', 'Plastic', 'Metal', 'Glass', 'Textile', 'Processed E-Waste', 'Other'],
    {
      required_error: 'Choose one material category',
    },
  ),
  weight: z.coerce.number().positive('Enter a valid total weight'),
  unit: z.enum(['kg', 'piece']),
  grade: z.string().min(1, 'Choose a grade'),
  expectedPrice: z.coerce.number().nonnegative('Enter an asking price'),
  location: z.string().min(2, 'Enter the lot location'),
  description: z.string().max(500).optional(),
  processingInfo: z.string().max(500).optional(),
});
function LotForm({ type }: { type: 'single' | 'mixed' | 'e-waste' }) {
  const router = useRouter();
  const t = useTranslation();
  const [photo, setPhoto] = useState<File | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof lotSchema>>({
    resolver: zodResolver(lotSchema),
    defaultValues: { unit: 'kg' },
  });
  const labels: Record<typeof type, string> = {
    single: t('Post Lot'),
    mixed: t('Post Mixed Lot'),
    'e-waste': t('Post E-Waste'),
  };
  const categories =
    type === 'e-waste'
      ? [
          'Phone',
          'Laptop',
          'Computer Parts',
          'PCB',
          'Cable / Wire',
          'Battery',
          'Appliance',
          'Mixed Electronics',
          'Other',
        ]
      : type === 'mixed'
        ? ['Mixed Scrap']
        : ['Paper', 'Plastic', 'Metal', 'Glass', 'Cardboard', 'Textile', 'Other'];
  const categorySlug = (value: string) => {
    const names: Record<string, string> = {
      Paper: 'paper', Plastic: 'plastic', Metal: 'metal', Glass: 'glass', Cardboard: 'cardboard',
      Textile: 'other', 'Mixed Scrap': 'mixed', Phone: 'other', Laptop: 'other',
      'Computer Parts': 'other', PCB: 'integrated-circuits', 'Cable / Wire': 'ewaste-cables',
      Battery: 'electronic-battery', Appliance: 'other', 'Mixed Electronics': 'other', Other: 'other',
    };
    return names[value] ?? 'other';
  };
  return (
    <>
      {title(
        type === 'single'
          ? t('Single Material')
          : type === 'mixed'
            ? t('Mixed Scrap')
            : t('E-Waste'),
        t('Add only what you know. You can keep it simple.'),
      )}
      <form
        className="form-card"
        onSubmit={handleSubmit(async (values) => {
          setSubmitError(null);
          if (type === 'e-waste' && !photo) {
            setSubmitError('An e-waste photo is required for safety review.');
            return;
          }
          try {
            const body = new FormData();
            body.set('category', categorySlug(values.category));
            body.set('weight', String(values.weight));
            body.set('quantity', '1');
            body.set('geo', 'null');
            if (photo) body.set('photo', photo);
            if (type === 'e-waste') {
              await api.createEwasteListing(body);
            } else {
              body.set('name', values.category);
              body.set('buyPrice', String(values.expectedPrice));
              body.set('sellPrice', String(values.expectedPrice));
              body.set('priceUnit', values.unit === 'kg' ? 'per_kg' : 'per_piece');
              await api.createKnownListing(body);
            }
            router.push('/kabadiwala/lots/success');
          } catch (reason) {
            setSubmitError(reason instanceof Error ? reason.message : 'Your lot could not be saved.');
          }
        })}
      >
        <fieldset>
          <legend>
            {type === 'mixed'
              ? t('What is in the lot?')
              : type === 'e-waste'
                ? t('Device category')
                : t('Material category')}
          </legend>
          <div className="category-grid">
            {categories.map((category, index) => (
              <label className="category-option" key={category}>
                <input type="radio" value={category} {...register('category')} />
                <span>
                  {[<Archive key="a" />, <Recycle key="b" />, <Sparkles key="c" />][index % 3]}
                </span>
                {t(category)}
              </label>
            ))}
          </div>
          {errors.category && <em>{errors.category.message}</em>}
        </fieldset>
        <fieldset>
          <legend>{t('Photos')}</legend>
          <label className="photo-upload">
            <Camera />
            <span>{photo ? photo.name : t('Take or upload photos')}</span>
            <small>{type === 'e-waste' ? t('One clear image is required for the safety review.') : t('Clear photos help buyers understand your scrap.')}</small>
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} />
          </label>
        </fieldset>
        <div className="form-grid">
          <label>
            {t('Approximate weight')}
            <input inputMode="decimal" placeholder={t('e.g. 10')} {...register('weight')} />
            {errors.weight && <em>{errors.weight.message}</em>}
          </label>
          <label>
            {t('Unit')}
            <select {...register('unit')}>
              <option value="kg">{t('Kilograms (kg)')}</option>
              <option value="piece">{t('Pieces')}</option>
            </select>
          </label>
        </div>
        {type === 'e-waste' && (
          <label>
            {t('Condition')}
            <select>
              <option>{t('Working')}</option>
              <option>{t('Damaged')}</option>
              <option>{t('Scrap')}</option>
              <option>{t('Unknown')}</option>
            </select>
          </label>
        )}
        <label>
          {t('Expected price (₹)')}
          <input
            inputMode="numeric"
            placeholder={t('Enter amount')}
            {...register('expectedPrice')}
          />
          {errors.expectedPrice && <em>{errors.expectedPrice.message}</em>}
        </label>
        <label>
          {t('Location')}
          <input placeholder={t('Your area or locality')} {...register('location')} />
          {errors.location && <em>{errors.location.message}</em>}
        </label>
        <label>
          {t('Notes (optional)')}
          <textarea placeholder={t('Anything buyers should know')} rows={3} />
        </label>
        {submitError && <div className="inline-error" role="alert">{submitError}</div>}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <LoaderCircle className="spin" /> {t('Posting...')}
            </>
          ) : (
            labels[type]
          )}
        </Button>
      </form>
    </>
  );
}
function CreateLot() {
  const router = useRouter();
  const t = useTranslation();
  const options = [
    {
      type: 'single',
      icon: <Archive />,
      title: t('Single Material'),
      copy: t('Paper, plastic, metal and more'),
    },
    {
      type: 'mixed',
      icon: <Recycle />,
      title: t('Mixed Scrap'),
      copy: t('Different types together'),
    },
    {
      type: 'e-waste',
      icon: <Sparkles />,
      title: t('E-Waste'),
      copy: t('Phones, wires, batteries and electronics'),
    },
  ];
  return (
    <>
      {title(t('What are you selling?'), t('Choose the option that matches your scrap.'))}
      <div className="lot-choices">
        {options.map((option) => (
          <button
            key={option.type}
            onClick={() => router.push(`/kabadiwala/create-lot/${option.type}`)}
          >
            <Icon>{option.icon}</Icon>
            <span>
              <b>{option.title}</b>
              <small>{option.copy}</small>
            </span>
            <ChevronRight />
          </button>
        ))}
      </div>
    </>
  );
}
function Success() {
  const router = useRouter();
  const t = useTranslation();
  return (
    <section className="success-state">
      <div>
        <CheckCircle2 size={72} />
      </div>
      <h1>{t('Your scrap is listed for sale.')}</h1>
      <p>{t('We will let you know when a buyer is interested.')}</p>
      <Button onClick={() => router.push('/kabadiwala/lots')}>{t('View My Lot')}</Button>
      <Button kind="quiet" onClick={() => router.push('/kabadiwala/home')}>
        {t('Go Home')}
      </Button>
    </section>
  );
}

const materialRateCategories = [
  {
    id: 'paper',
    name: 'Paper & cardboard',
    image: '/images/material-rates/paper-scrap.png',
    alt: 'Sorted recyclable paper, cardboard, books and newspapers',
    rates: [
      ['Newspaper', 13],
      ['Carton', 12],
      ['Books', 12],
      ['Grey Board', 3],
      ['Copy', 12],
      ['Magazines', 10],
      ['Record Paper', 12],
      ['White Paper', 12],
      ['Used Beverage Carton', 5],
    ],
  },
  {
    id: 'metal',
    name: 'Metal',
    image: '/images/material-rates/metal-scrap.png',
    alt: 'Sorted recyclable iron, steel, aluminium, brass and copper scrap',
    rates: [
      ['Iron', 25],
      ['Tin', 20],
      ['Aluminium', 150],
      ['Steel', 45],
      ['Brass', 450],
      ['Copper', 600],
      ['Casting Aluminium', 140],
      ['Copper Wire', 60],
      ['Aluminium Wire', 18],
      ['Beverage Cans — Aluminium', 120],
      ['Inverter Battery', 80],
    ],
  },
] as const;

function LocalPrices({ language }: { language: AppLanguage }) {
  const t = (key: string) => translate(language, key);
  return (
    <>
      {title(t('Local Prices'), 'Paper and metal rates supplied on 29 Sep 2026.')}
      <section className="rate-callout">
        <IndianRupee size={21} />
        <p>
          <b>All rates are per kg.</b> Use these as your current collection reference before posting a lot.
        </p>
      </section>
      <div className="rate-category-grid">
        {materialRateCategories.map((category) => (
          <section className="rate-category-card" key={category.id}>
            <div className="rate-category-image">
              <img src={category.image} alt={category.alt} />
              <span>{category.name}</span>
            </div>
            <div className="rate-list" aria-label={`${category.name} rates`}>
              {category.rates.map(([material, rate]) => (
                <div className="rate-row" key={material}>
                  <span>{material}</span>
                  <strong>₹{rate}</strong>
                  <small>/ kg</small>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function SimpleKabadiPage({
  kind,
  language,
  onLanguageChange,
}: {
  kind: 'lots' | 'pickups' | 'ledger' | 'prices' | 'scan' | 'profile';
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
}) {
  const router = useRouter();
  const t = (key: string) => translate(language, key);
  const content = {
    lots: [
      t('My Lots'),
      t("You haven't listed any scrap yet."),
      t('Sell Scrap'),
      () => router.push('/kabadiwala/create-lot'),
    ],
    pickups: [
      t('Pickup Requests'),
      t('No pickup requests right now.'),
      t('Go Home'),
      () => router.push('/kabadiwala/home'),
    ],
    ledger: [
      t('Your Ledger'),
      t('Your completed transactions will appear here.'),
      t('Go Home'),
      () => router.push('/kabadiwala/home'),
    ],
    prices: [t('Local Prices'), t('Prices are not available right now.'), t('Try again'), () => {}],
  } as const;
  if (kind === 'scan')
    return (
      <>
        {title(t('Scan Material'), t('Take a clear photo and we will help identify it.'))}
        <section className="scanner">
          <div className="scanner-frame">
            <Camera size={44} />
            <strong>{t('Take a photo')}</strong>
            <span>{t('Keep the material in good light.')}</span>
            <Button>{t('Open Camera')}</Button>
          </div>
          <p>{t('No result will appear until the scan is complete.')}</p>
        </section>
      </>
    );
  if (kind === 'profile')
    return (
      <>
        {title(translate(language, 'profile'), t('Manage the basics.'))}
        <section className="profile-list">
          <div className="profile-language" key="language">
            <span>{translate(language, 'language')}</span>
            <LanguageSwitcher language={language} onChange={onLanguageChange} compact />
          </div>
          {['UPI / payment details', 'Help', 'How to use the app'].map((item) => (
            <button key={item}>
              {t(item)}
              <ChevronRight />
            </button>
          ))}
          <button
            className="danger"
            onClick={() =>
              signOut(getFirebaseAuth()).finally(() => router.push('/auth/login'))
            }
          >
            {t('Logout')}
            <LogOut />
          </button>
        </section>
      </>
    );
  if (kind === 'prices') return <LocalPrices language={language} />;
  const [heading, copy, action, fn] = content[kind];
  return (
    <>
      {title(heading)}
      <EmptyState
        title={heading === t('My Lots') ? t('No scrap listed yet') : heading}
        copy={copy}
        action={<Button onClick={fn}>{action}</Button>}
      />
    </>
  );
}

function Shop({ role, type }: { role: UserRole; type: 'collector' | 'middleman' }) {
  const router = useRouter();
  const t = useTranslation();
  const allowed = type === 'collector' ? can(role, 'collectorShop') : can(role, 'middlemanShop');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ category: '', minPrice: '', maxPrice: '' });
  const [items, setItems] = useState<ShopItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    const query = { category: filters.category, minPrice: filters.minPrice, maxPrice: filters.maxPrice };
    const load =
      role === 'MIDDLEMAN'
        ? api.getCollectorLots(query)
        : type === 'collector'
          ? api.getRecyclerCollectorLots(query)
          : api.getMiddlemanLots(query);
    load
      .then(({ items: results }) => {
        if (active) setItems(results);
      })
      .catch((reason) => {
        if (active) setLoadError(reason instanceof Error ? reason.message : 'Unable to load listings.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filters.category, filters.minPrice, filters.maxPrice, role, type]);
  if (!allowed) return <Unauthorized />;
  const normal = type === 'collector';
  const directBlocked = role === 'RECYCLER' && normal;
  const activeFilterCount = [search, filters.category, filters.minPrice, filters.maxPrice].filter(
    Boolean,
  ).length;
  const hasFilters = activeFilterCount > 0;
  const clearFilters = () => {
    setSearch('');
    setFilters({ category: '', minPrice: '', maxPrice: '' });
  };
  return (
    <>
      {title(
        type === 'collector' ? t('Collector Shop') : t('Aggregator Shop'),
        type === 'collector'
          ? t('Buy available material from local collectors.')
          : t('Browse category-specific, segregated bulk material prepared by aggregators.'),
      )}
      {role === 'RECYCLER' && (
        <section className="shop-source-switch" aria-label="Recycler material sources">
          <span>{t('Source material from')}</span>
          <button
            type="button"
            className={type === 'collector' ? 'active' : ''}
            aria-current={type === 'collector' ? 'page' : undefined}
            onClick={() => router.push('/recycler/collector-shop')}
          >
            <ShoppingBag size={17} /> {t('Collector Shop')}
          </button>
          <button
            type="button"
            className={type === 'middleman' ? 'active' : ''}
            aria-current={type === 'middleman' ? 'page' : undefined}
            onClick={() => router.push('/recycler/middleman-shop')}
          >
            <Recycle size={17} /> {t('Aggregator Shop')}
          </button>
        </section>
      )}
      <div className="shop-tools">
        <label className="search">
          <Search size={18} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('Search material')}
          />
        </label>
        <Button kind="secondary" onClick={() => setFiltersOpen((value) => !value)}>
          <SlidersHorizontal size={17} /> {t('Filters')}
          {activeFilterCount ? ` (${activeFilterCount})` : ''}
        </Button>
        {hasFilters && (
          <Button kind="quiet" onClick={clearFilters}>
            {t('Clear')}
          </Button>
        )}
      </div>
      {filtersOpen && (
        <section className="shop-filter-panel" aria-label={t('Filter available material')}>
          <div className="shop-filter-heading">
            <div>
              <b>{t('Refine available material')}</b>
              <small>{t('Filter by material category and the total lot price.')}</small>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label={t('Close filters')}
              onClick={() => setFiltersOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="shop-filter-fields">
            <label>
              {t('Material category')}
              <select
                value={filters.category}
                onChange={(event) =>
                  setFilters((value) => ({ ...value, category: event.target.value }))
                }
              >
                <option value="">{t('All categories')}</option>
                <option value="paper">{t('Paper')}</option>
                <option value="cardboard">{t('Cardboard')}</option>
                <option value="plastic">{t('Plastic')}</option>
                <option value="metal">{t('Metal')}</option>
                <option value="glass">{t('Glass')}</option>
                <option value="copper-scrap">{t('Copper scrap')}</option>
                <option value="electronic-battery">{t('Batteries')}</option>
                <option value="ewaste-cables">{t('E-waste cables')}</option>
                <option value="other">{t('Other')}</option>
              </select>
            </label>
            <label>
              {t('Minimum total price (₹)')}
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={filters.minPrice}
                onChange={(event) =>
                  setFilters((value) => ({ ...value, minPrice: event.target.value }))
                }
                placeholder={t('No minimum')}
              />
            </label>
            <label>
              {t('Maximum total price (₹)')}
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={filters.maxPrice}
                onChange={(event) =>
                  setFilters((value) => ({ ...value, maxPrice: event.target.value }))
                }
                placeholder={t('No maximum')}
              />
            </label>
          </div>
        </section>
      )}
      {loadError ? (
        <section className="inline-error" role="alert">{loadError}</section>
      ) : loading ? (
        <Skeleton />
      ) : items.filter((item) => item.name.toLowerCase().includes(search.toLowerCase())).length ? (
        <section className="metric-grid" aria-label={t('Available lots')}>
          {items
            .filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))
            .map((item) => (
              <article className="metric-card" key={item.id}>
                <b>{item.name}</b>
                <small>{item.category} · {item.weight} kg · {item.condition}</small>
                <strong>₹{item.price.toLocaleString('en-IN')}</strong>
                {item.requiresMiddlemanProcessing && <small>{t('Requires aggregator processing')}</small>}
              </article>
            ))}
        </section>
      ) : (
        <EmptyState
          title={
            hasFilters
              ? t('No lots match these filters right now.')
              : type === 'collector'
                ? t('No lots are available right now.')
                : t('No category bulk lots are available right now.')
          }
          copy={
            hasFilters
              ? t('Try another material category or total-price range, or clear your filters to view all available lots.')
              : directBlocked
                ? t('Raw e-waste from collectors will require middleman processing before you can buy it.')
                : t('New material will appear here when sellers list it.')
          }
        />
      )}
      <section className="permission-note">
        <b>{t('Purchase rules')}</b>
        <p>
          {role === 'MIDDLEMAN'
            ? t(
                'You can purchase collector lots, including raw e-waste, and then prepare them for batches.',
              )
            : type === 'collector'
              ? t(
                  'Raw e-waste cannot be purchased directly. It must first be inspected and processed by an aggregator.',
                )
              : t('Each category bulk lot contains one processed, segregated material category.')}
        </p>
      </section>
    </>
  );
}
function AdminDashboard() {
  const [stats, setStats] = useState<Awaited<ReturnType<typeof api.getAdminStats>> | null>(null);
  const [users, setUsers] = useState<Awaited<ReturnType<typeof api.getAdminUsers>>['items']>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextStats, nextUsers] = await Promise.all([api.getAdminStats(), api.getAdminUsers()]);
      setStats(nextStats);
      setUsers(nextUsers.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load admin data.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const verify = async (uid: string, status: 'verified' | 'rejected') => {
    try {
      await api.verifyUser(uid, status);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update verification.');
    }
  };
  return (
    <>
      {title('Admin dashboard', 'Review platform activity and approve buyer accounts.')}
      {error && <section className="inline-error" role="alert">{error}</section>}
      {loading ? (
        <Skeleton />
      ) : (
        <>
          <section className="metric-grid">
            {[
              ['Users', users.length],
              ['Listings', stats?.totalListings ?? 0],
              ['Completed deals', stats?.completedDeals ?? 0],
              ['Value transacted', `₹${(stats?.totalValueTransacted ?? 0).toLocaleString('en-IN')}`],
            ].map(([label, value]) => (
              <article className="metric-card" key={String(label)}>
                <b>{label}</b>
                <strong>{value}</strong>
              </article>
            ))}
          </section>
          <section className="form-card">
            <h2>Account verification</h2>
            <p className="form-hint">Collector accounts are automatically verified. Aggregators and recyclers need approval before trading.</p>
            {users.map((user) => (
              <div className="profile-list" key={user.id}>
                <div>
                  <b>{user.name}</b>
                  <small>{user.email} · {user.role} · {user.verificationStatus}</small>
                </div>
                {user.verificationStatus === 'pending' && (user.role === 'middleman' || user.role === 'recycler') && (
                  <div className="form-grid">
                    <Button onClick={() => void verify(user.id, 'verified')}>Approve</Button>
                    <Button kind="secondary" onClick={() => void verify(user.id, 'rejected')}>Reject</Button>
                  </div>
                )}
              </div>
            ))}
          </section>
        </>
      )}
    </>
  );
}

function BuyerDashboard({ role }: { role: UserRole }) {
  const router = useRouter();
  const t = useTranslation();
  const middleman = role === 'MIDDLEMAN';
  return (
    <>
      {title(
        middleman ? t('Good morning') : t('Material sourcing'),
        middleman
          ? t('Keep purchases moving toward ready batches.')
          : t('Find material that fits your recycling needs.'),
      )}
      <section className="metric-grid">
        {(middleman
          ? [
              [t('Available Collector Lots'), t('Browse what is ready to buy')],
              [t('Active Purchases'), t('No active purchases')],
              [t('Pending Inspections'), t('Nothing waiting')],
              [t('Active Category Listings'), t('No listings yet')],
            ]
          : [
              [t('Available Collector Lots'), t('Normal recyclable material')],
              [t('Available Category Lots'), t('One segregated category per lot')],
              [t('Active Orders'), t('No open orders')],
              [t('Purchased Material'), t('Your completed orders')],
            ]
        ).map(([name, note], index) => (
          <article className="metric-card" key={name}>
            <span>
              {
                [
                  <ShoppingBag key="1" />,
                  <Archive key="2" />,
                  <ClipboardList key="3" />,
                  <Recycle key="4" />,
                ][index]
              }
            </span>
            <b>{name}</b>
            <small>{note}</small>
          </article>
        ))}
      </section>
      <section className="action-panel">
        <div>
          <h2>
            {middleman ? t('Buy, process, and build a batch.') : t('Browse available material.')}
          </h2>
          <p>
            {middleman
              ? t(
                  'Start in the Collector Shop, then inspect inventory before listing for recyclers.',
                )
              : t('Compare collector lots and segregated category bulk lots from aggregators.')}
          </p>
        </div>
        <div>
          <Button onClick={() => router.push(`/${role.toLowerCase()}/collector-shop`)}>
            {t('Browse')} {middleman ? t('Collector Shop') : t('Collector Lots')}
          </Button>
          {middleman ? (
            <Button kind="secondary" onClick={() => router.push('/middleman/create-batch')}>
              {t('Create Category Lot')}
            </Button>
          ) : (
            <Button kind="secondary" onClick={() => router.push('/recycler/middleman-shop')}>
              {t('Browse Category Lots')}
            </Button>
          )}
        </div>
      </section>
    </>
  );
}
function DirectMiddlemanLotForm() {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const t = useTranslation();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof directBulkLotSchema>>({
    resolver: zodResolver(directBulkLotSchema),
    defaultValues: { unit: 'kg', grade: 'Standard' },
  });
  return (
    <form
      className="form-card direct-lot-form"
      onSubmit={handleSubmit(async (values) => {
        setSubmitError(null);
        try {
          throw new Error('Category lots must be created from processed inventory. Direct stock listings are not supported by this backend.');
        } catch (error) {
          setSubmitError(error instanceof Error ? error.message : 'Your lot could not be saved.');
        }
      })}
    >
      <fieldset>
        <legend>{t('Segregated material')}</legend>
        <p className="form-hint">
          {t('Choose one material category only. Do not combine categories in this listing.')}
        </p>
        <div className="form-grid">
          <label>
            {t('Material category')}
            <select {...register('category')}>
              <option value="">{t('Choose material')}</option>
              <option value="Paper">{t('Paper')}</option>
              <option value="Plastic">{t('Plastic')}</option>
              <option value="Metal">{t('Metal')}</option>
              <option value="Glass">{t('Glass')}</option>
              <option value="Textile">{t('Textile')}</option>
              <option value="Processed E-Waste">{t('Processed E-Waste')}</option>
              <option value="Other">{t('Other')}</option>
            </select>
            {errors.category && <em>{errors.category.message}</em>}
          </label>
          <label>
            {t('Grade / quality')}
            <select {...register('grade')}>
              <option value="Standard">{t('Standard')}</option>
              <option value="Premium">{t('Premium')}</option>
              <option value="Needs Inspection">{t('Needs Inspection')}</option>
            </select>
            {errors.grade && <em>{errors.grade.message}</em>}
          </label>
        </div>
      </fieldset>
      <div className="form-grid">
        <label>
          {t('Total weight')}
          <input inputMode="decimal" placeholder={t('e.g. 250')} {...register('weight')} />
          {errors.weight && <em>{errors.weight.message}</em>}
        </label>
        <label>
          {t('Unit')}
          <select {...register('unit')}>
            <option value="kg">{t('Kilograms (kg)')}</option>
            <option value="piece">{t('Pieces')}</option>
          </select>
        </label>
      </div>
      <fieldset>
        <legend>{t('Photos')}</legend>
        <button type="button" className="photo-upload">
          <Camera />
          <span>{t('Add material photos')}</span>
          <small>{t('Clear photos help recyclers review your direct lot.')}</small>
        </button>
      </fieldset>
      <div className="form-grid">
        <label>
          {t('Asking price (₹)')}
          <input
            inputMode="numeric"
            placeholder={t('Enter total amount')}
            {...register('expectedPrice')}
          />
          {errors.expectedPrice && <em>{errors.expectedPrice.message}</em>}
        </label>
        <label>
          {t('Lot location')}
          <input placeholder={t('Area or locality')} {...register('location')} />
          {errors.location && <em>{errors.location.message}</em>}
        </label>
      </div>
      <label>
        {t('Material description (optional)')}
        <textarea
          rows={3}
          placeholder={t('Describe the separated material and its condition')}
          {...register('description')}
        />
      </label>
      <label>
        {t('Processing details (optional)')}
        <textarea
          rows={3}
          placeholder={t('Describe sorting, cleaning, inspection, or e-waste processing')}
          {...register('processingInfo')}
        />
      </label>
      {submitError && (
        <div className="inline-error" role="alert">
          <strong>{t('Lot not saved')}</strong>
          <span>
            {submitError} {t('Your information is still on this page.')}
          </span>
        </div>
      )}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <LoaderCircle className="spin" /> {t('Saving...')}
          </>
        ) : (
          t('Create Category Bulk Lot')
        )}
      </Button>
    </form>
  );
}
function CreateBulkLot() {
  const t = useTranslation();
  return (
    <>
      {title(
        t('Create Category Bulk Lot'),
        t(
          'List one already-segregated material category, either from your own stock or processed inventory.',
        ),
      )}
      <section className="workflow-card">
        <div className="workflow-step">
          <Archive />
          <span>
            <b>{t('Processed inventory required')}</b>
            <small>{t('Category lots are created only from inspected, segregated inventory.')}</small>
          </span>
        </div>
        <EmptyState
          title={t('Nothing ready for a category lot')}
          copy={t('Buy a collector lot, inspect it, and record one material category before creating a recycler listing.')}
        />
      </section>
    </>
  );
}
function MiddlemanWorkspace({
  kind,
}: {
  kind: 'inventory' | 'batches' | 'orders' | 'ledger' | 'create-batch' | 'e-waste';
}) {
  const t = useTranslation();
  const names = {
    inventory: [t('Inventory'), t('Your purchased material will appear here.')],
    batches: [t('My Category Lots'), t('Each listing contains one separated material category.')],
    orders: [t('Orders'), t('Purchases and sales will appear here.')],
    ledger: [t('Ledger'), t('Your purchases, sales, and payment records will appear here.')],
    'create-batch': [
      t('Create Category Bulk Lot'),
      t('Select one segregated material category to make a recycler-ready lot.'),
    ],
    'e-waste': [
      t('E-Waste Processing'),
      t('E-waste must be received and checked before it can go to a recycler.'),
    ],
  } as const;
  const [heading, copy] = names[kind];
  if (kind === 'create-batch') return <CreateBulkLot />;
  if (kind === 'e-waste')
    return (
      <>
        {title(heading, copy)}
        <EmptyState
          title={t('No e-waste waiting')}
          copy={t('Raw e-waste purchased from collectors will appear here for inspection.')}
        />
      </>
    );
  return (
    <>
      {title(heading)}
      <EmptyState title={heading} copy={copy} />
    </>
  );
}
function Unauthorized() {
  const router = useRouter();
  const t = useTranslation();
  return (
    <section className="unauthorized">
      <div className="empty-art">
        <Leaf size={34} />
      </div>
      <h1>{t('This area is not available to your role.')}</h1>
      <p>{t('Your account does not have permission to open this page.')}</p>
      <Button onClick={() => router.push('/auth/select-role')}>{t('Back to sign in')}</Button>
    </section>
  );
}
function NotFound() {
  const router = useRouter();
  const t = useTranslation();
  return (
    <section className="unauthorized">
      <h1>{t('Page not found')}</h1>
      <p>{t('The link may be incomplete or the page has moved.')}</p>
      <Button onClick={() => router.push('/auth/login')}>{t('Go to login')}</Button>
    </section>
  );
}

export function App() {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<UserRole | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [language, setLanguage] = useState<AppLanguage>('en');
  useEffect(() => {
    const savedLanguage = window.localStorage.getItem('kabadiwala-language') as AppLanguage | null;
    if (savedLanguage && ['en', 'hi', 'mr', 'ta', 'bn', 'te', 'kn'].includes(savedLanguage))
      setLanguage(savedLanguage);
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = onAuthStateChanged(getFirebaseAuth(), async (user) => {
        if (!user) {
          setRole(null);
          setAuthReady(true);
          return;
        }
        try {
          const { profile } = await api.verifyToken();
          setRole(profile ? frontendRole(profile) : null);
        } catch {
          setRole(null);
        } finally {
          setAuthReady(true);
        }
      });
    } catch {
      setAuthReady(true);
    }
    return () => unsubscribe?.();
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const changeLanguage = (next: AppLanguage) => {
    window.localStorage.setItem('kabadiwala-language', next);
    setLanguage(next);
  };
  const logout = () => {
    signOut(getFirebaseAuth()).finally(() => {
      setRole(null);
      router.push('/auth/login');
    });
  };
  if (!authReady)
    return <main className="auth-layout"><section className="auth-panel"><div className="auth-card">Checking your session…</div></section></main>;
  if (!role || pathname.startsWith('/auth') || pathname === '/onboarding')
    return <AuthPage language={language} onLanguageChange={changeLanguage} onAuthenticated={(profile) => setRole(frontendRole(profile))} />;
  const rootRole: UserRole | undefined = pathname.startsWith('/kabadiwala')
    ? 'KABADIWALA'
    : pathname.startsWith('/middleman')
      ? 'MIDDLEMAN'
      : pathname.startsWith('/recycler')
        ? 'RECYCLER'
        : pathname.startsWith('/admin')
          ? 'ADMIN'
        : undefined;
  if (!rootRole)
    return (
      <TranslationProvider language={language}>
        <NotFound />
      </TranslationProvider>
    );
  if (rootRole !== role)
    return (
      <TranslationProvider language={language}>
        <AppShell role={role} language={language} setLanguage={changeLanguage} onLogout={logout}>
          <Unauthorized />
        </AppShell>
      </TranslationProvider>
    );
  const content =
    rootRole === 'ADMIN' ? (
      <AdminDashboard />
    ) : pathname === '/kabadiwala' || pathname.includes('/home') ? (
      <KabadiHome language={language} />
    ) : pathname === '/kabadiwala/create-lot' ? (
      <CreateLot />
    ) : pathname.includes('/create-lot/single') ? (
      <LotForm type="single" />
    ) : pathname.includes('/create-lot/mixed') ? (
      <LotForm type="mixed" />
    ) : pathname.includes('/create-lot/e-waste') ? (
      <LotForm type="e-waste" />
    ) : pathname.includes('/lots/success') ? (
      <Success />
    ) : pathname.includes('/lots') ? (
      <SimpleKabadiPage kind="lots" language={language} onLanguageChange={changeLanguage} />
    ) : pathname.includes('/pickups') ? (
      <SimpleKabadiPage kind="pickups" language={language} onLanguageChange={changeLanguage} />
    ) : rootRole === 'KABADIWALA' && pathname.includes('/ledger') ? (
      <SimpleKabadiPage kind="ledger" language={language} onLanguageChange={changeLanguage} />
    ) : pathname.includes('/prices') ? (
      <SimpleKabadiPage kind="prices" language={language} onLanguageChange={changeLanguage} />
    ) : pathname.includes('/scan') ? (
      <SimpleKabadiPage kind="scan" language={language} onLanguageChange={changeLanguage} />
    ) : pathname.includes('/profile') ? (
      <SimpleKabadiPage kind="profile" language={language} onLanguageChange={changeLanguage} />
    ) : pathname.includes('collector-shop') ? (
      <Shop role={role} type="collector" />
    ) : pathname.includes('middleman-shop') ? (
      <Shop role={role} type="middleman" />
    ) : pathname.includes('inventory') ? (
      <MiddlemanWorkspace kind="inventory" />
    ) : pathname.includes('batches') ? (
      <MiddlemanWorkspace kind="batches" />
    ) : pathname.includes('create-batch') ? (
      <MiddlemanWorkspace kind="create-batch" />
    ) : pathname.includes('e-waste') ? (
      <MiddlemanWorkspace kind="e-waste" />
    ) : pathname.includes('orders') ? (
      <MiddlemanWorkspace kind="orders" />
    ) : pathname.includes('ledger') ? (
      <MiddlemanWorkspace kind="ledger" />
    ) : (
      <BuyerDashboard role={role} />
    );
  return (
    <TranslationProvider language={language}>
      <AppShell role={role} language={language} setLanguage={changeLanguage} onLogout={logout}>
        {content}
      </AppShell>
    </TranslationProvider>
  );
}
