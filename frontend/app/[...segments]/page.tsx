import { App } from "@/components/app";

const routes = [
  'auth/login',
  'auth/select-role',
  'onboarding',
  'kabadiwala',
  'kabadiwala/home',
  'kabadiwala/create-lot',
  'kabadiwala/create-lot/single',
  'kabadiwala/create-lot/mixed',
  'kabadiwala/create-lot/e-waste',
  'kabadiwala/lots',
  'kabadiwala/lots/success',
  'kabadiwala/pickups',
  'kabadiwala/ledger',
  'kabadiwala/prices',
  'kabadiwala/scan',
  'kabadiwala/profile',
  'middleman/dashboard',
  'middleman/collector-shop',
  'middleman/inventory',
  'middleman/batches',
  'middleman/create-batch',
  'middleman/e-waste',
  'middleman/orders',
  'middleman/ledger',
  'middleman/profile',
  'recycler/dashboard',
  'recycler/collector-shop',
  'recycler/middleman-shop',
  'recycler/orders',
  'recycler/ledger',
  'recycler/profile',
  'admin',
];

export function generateStaticParams() {
  return routes.map((route) => ({ segments: route.split('/') }));
}

export default function RoutePage() { return <App />; }
