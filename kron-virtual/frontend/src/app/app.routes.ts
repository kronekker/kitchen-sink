import { Routes } from '@angular/router';
import { Sessions } from './features/sessions/sessions';
import { Characters } from './features/characters/characters';
import { Personas } from './features/personas/personas';
import { Styles } from './features/styles/styles';
import { Studio } from './features/studio/studio';

export const routes: Routes = [
  { path: '', redirectTo: 'sessions', pathMatch: 'full' },
  { path: 'sessions', component: Sessions },
  { path: 'characters', component: Characters },
  { path: 'personas', component: Personas },
  { path: 'styles', component: Styles },
  { path: 'studio', component: Studio },
  { path: '**', redirectTo: 'sessions' },
];
