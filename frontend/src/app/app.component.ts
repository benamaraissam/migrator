import { Component, OnInit, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MsalService } from '@azure/msal-angular';
import { filter } from 'rxjs';
import { isMsalEnabled } from './core/auth/msal-config';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  title = 'frontend';

  private readonly msal = inject(MsalService, { optional: true });

  ngOnInit(): void {
    if (isMsalEnabled() && this.msal) {
      this.msal.handleRedirectObservable().subscribe();
    }
  }
}
