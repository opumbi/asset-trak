import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID, FirestoreErrorInfo } from '../lib/firebase';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  rawMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    rawMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      rawMessage: error.message || 'An unexpected error occurred.',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught application error:', error, errorInfo);
  }

  private handleReload = () => {
    this.setState({ hasError: false, rawMessage: '' });
    window.location.reload();
  };

  public render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    let parsedFirestoreError: FirestoreErrorInfo | null = null;
    try {
      const candidate = JSON.parse(this.state.rawMessage) as FirestoreErrorInfo;
      if (candidate && typeof candidate.error === 'string' && candidate.operationType) {
        parsedFirestoreError = candidate;
      }
    } catch {
      parsedFirestoreError = null;
    }

    const displayErrorText = parsedFirestoreError
      ? parsedFirestoreError.error
      : this.state.rawMessage;

    const isQuotaError = displayErrorText.includes('Quota exceeded');
    const isSpecificFreeTierReadQuota = displayErrorText.includes(
      "Quota exceeded for quota metric 'Free daily read units per project (free tier database)'"
    );

    const upgradeLink = `https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/firestore/databases/${FIRESTORE_DATABASE_ID}/data?openUpgradeDialog=true`;

    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-white border border-slate-200 rounded-2xl p-6 sm:p-8">
          <div className="w-11 h-11 rounded-xl bg-red-50 text-red-600 flex items-center justify-center mb-4">
            <AlertTriangle className="w-5 h-5" />
          </div>

          <h1 className="text-xl font-semibold text-slate-900 mb-2">
            {isQuotaError ? 'Daily Database Quota Reached' : 'Unable to Complete Operation'}
          </h1>

          {isQuotaError ? (
            <div className="space-y-3 text-sm text-slate-600 leading-relaxed mb-6">
              <p>
                Your Firestore free-tier daily usage quota has been reached and will automatically
                reset tomorrow.
              </p>
              {isSpecificFreeTierReadQuota && (
                <p>
                  You can review or upgrade your database plan directly in the{' '}
                  <a
                    href={upgradeLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 font-medium underline hover:text-blue-700"
                  >
                    Firebase Console
                  </a>
                  .
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-600 leading-relaxed mb-4">
              {displayErrorText}
            </p>
          )}

          {parsedFirestoreError && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 mb-6 text-xs font-mono text-slate-600 space-y-1">
              <div>Operation: {parsedFirestoreError.operationType}</div>
              {parsedFirestoreError.path && <div>Path: {parsedFirestoreError.path}</div>}
              <div>
                Email Verified:{' '}
                {parsedFirestoreError.authInfo.emailVerified ? 'Yes' : 'No'}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={this.handleReload}
            className="min-h-[44px] px-5 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-xl hover:bg-slate-800 transition-colors inline-flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Reload Application</span>
          </button>
        </div>
      </div>
    );
  }
}
