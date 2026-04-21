import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null, 
      errorInfo: null,
      errorId: Math.random().toString(36).substring(7)
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    
    // Log specific details about iteration errors
    if (error.message && error.message.includes('not iterable')) {
      console.error('ITERATION ERROR DETAILS:', {
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        errorBoundaryId: this.state.errorId
      });
    }
    
    this.setState({
      error: error,
      errorInfo: errorInfo
    });
  }

  handleReset = () => {
    this.setState({ 
      hasError: false, 
      error: null, 
      errorInfo: null,
      errorId: Math.random().toString(36).substring(7)
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir="rtl">
          <Card className="w-full max-w-2xl">
            <CardHeader className="text-center">
              <div className="flex justify-center mb-4">
                <AlertTriangle className="h-12 w-12 text-red-500" />
              </div>
              <CardTitle className="text-2xl text-red-600">
                אירעה שגיאה באפליקציה
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm text-red-800 font-medium mb-2">
                  שגיאה: {this.state.error?.message || 'שגיאה לא ידועה'}
                </p>
                <p className="text-xs text-red-600">
                  מזהה שגיאה: {this.state.errorId}
                </p>
              </div>
              
              {this.state.error?.message?.includes('not iterable') && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-sm text-yellow-800 font-medium mb-2">
                    זוהתה שגיאת איטרציה
                  </p>
                  <p className="text-xs text-yellow-700">
                    הבעיה נגרמת כאשר הקוד מנסה לעבור על משתנה שאינו מערך. 
                    פרטי השגיאה נשמרו ב-console לצורך איתור הבעיה.
                  </p>
                </div>
              )}
              
              <div className="flex gap-2 justify-center">
                <Button onClick={this.handleReset} className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  תנסה שוב
                </Button>
                <Button 
                  variant="outline" 
                  onClick={() => window.location.reload()}
                  className="flex items-center gap-2"
                >
                  רענן דף
                </Button>
              </div>
              
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-gray-600 hover:text-gray-800">
                  פרטים טכניים (למפתחים)
                </summary>
                <div className="mt-2 p-3 bg-gray-100 rounded text-xs font-mono text-left overflow-auto max-h-40">
                  <div className="mb-2">
                    <strong>Error:</strong> {this.state.error?.toString()}
                  </div>
                  <div className="mb-2">
                    <strong>Stack:</strong>
                    <pre className="whitespace-pre-wrap">{this.state.error?.stack}</pre>
                  </div>
                  <div>
                    <strong>Component Stack:</strong>
                    <pre className="whitespace-pre-wrap">{this.state.errorInfo?.componentStack}</pre>
                  </div>
                </div>
              </details>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;