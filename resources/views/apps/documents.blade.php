{{-- Documents: the canvas Documents built in the office workspace (liteapps/office/apps/documents) and
     installed into public/assets/apps/documents by `npm run install:documents` there. The app draws its own title
     bar (window chrome "custom") and reaches the OS only through the SDK, so this page loads LOS_CONFIG and the SDK,
     then the app's module. The app's own stylesheet carries the LiteOS tokens it needs. --}}
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Documents</title>
@include('partials.app-favicon', ['app' => 'documents'])
<link rel="stylesheet" href="@versioned('assets/apps/documents/index.css')">
@include('partials.config')
</head>
<body>
<div id="root"></div>
<div id="print-root" aria-hidden="true"></div>

<script src="@versioned('assets/js/icons.js')"></script>
<script src="@versioned('assets/js/apps.js')"></script>
<script src="@versioned('assets/js/menu.js')"></script>
<script src="@versioned('assets/js/sdk.js')"></script>
<script type="module" src="@versioned('assets/apps/documents/app.js')"></script>
</body>
</html>
