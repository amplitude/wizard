<!--production-->

<!doctype html>
<html lang="en">
<head>
  <meta name='zd-site-verification' content='od3rs5oc4ggcruhipz6rp' />
  <meta charset="utf-8">
  

  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta content="" name="description">
  <meta name="google-site-verification" content="UHLjtoO7DV30dx3hVhwTOIWguEUr_VzS41msmq-uYKA" />
  
  <link rel="apple-touch-icon" sizes="180x180" href="/docs/assets/general/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/docs/assets/general/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/docs/assets/general/favicon-16x16.png">
  <title>iOS | Amplitude</title>
  
  <script type="application/ld+json">
{
    "@context": "https://schema.org",
    "@type": "WebPage",
    "datePublished": "",
    "dateModified": "May 15th, 2024",
    "headline": "iOS",
    "description": "",
    "url": "/docs/sdks/analytics/ios",
    "primaryImageOfPage": {
        "@id": "/docs/assets/images/amplitude-default-seo.png"
    },
    "publisher": {
        "@type": "Organization",
        "name": "Amplitude",
        "legalName": "Amplitude Inc.",
        "url": "https://amplitude.com/",
        "logo": {
            "@type": "ImageObject",
            "url": "https://amplitude.com/nextjs-public/amplitude-default-seo.png"
        },
        "address": {
            "@type": "PostalAddress",
            "streetAddress": "201 3rd St #200",
            "addressLocality": "San Francisco",
            "addressRegion": "CA",
            "postalCode": "94103",
            "addressCountry": "USA"
        },
        "contactPoint": {
            "@type": "ContactPoint",
            "contactType": "Customer Support",
            "telephone": "[+650-988-5131]",
            "email": "sales@amplitude.com"
        },
        "sameAs": [
            "https://twitter.com/Amplitude_HQ",
            "https://www.facebook.com/AmplitudeAnalytics/",
            "https://www.linkedin.com/company/amplitude-analytics"
        ]
    }
} 
</script>
  
    <style>
    /* Prism’s critical code-block styles only */
    code[class*="language-"],
    pre[class*="language-"] {
      color: #2a2a2a;
      background: #f5f2f0;
      font-family:"IBM Plex Mono", Consolas, Menlo, monospace;
      font-size: 0.9em;
      white-space: pre;
      /* …etc, just the essentials… */
    }
  </style>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/tocbot/4.25.0/tocbot.css">
  <link href="/docs/css/site.css?id=6e2f9e1efe9343c4ba65666223648444" rel="stylesheet">
  <link href="/docs/css/algolia.css?id=e343cc9490e043fefffa37d2817ddf8c" rel="stylesheet">
  <link href="/docs/css/dracula-prism.css?id=a5713888be640854bb66b8b74c1037ce" rel="stylesheet">
<style>
      pre[class*="language-"] code p {
  all: unset;        /* removes default block-level margins/padding */
  display: inline;   /* flow as if it were plain text */
}
</style>
  <script src="/docs/js/site.js?id=078a82617f7dafffff92da951b4ec6c9"></script>
  <script type="module" src="/docs/js/side-nav.js?id=b84c163c6c16a6a6b14fc85ee81c31e9"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/@alpinejs/collapse@3.x.x/dist/cdn.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/cdn.min.js"></script>
  <link rel="preconnect" href="https://93SYI9HL20-dsn.algolia.net" crossorigin />
  <script src="https://unpkg.com/@amplitude/experiment-js-client@1.9.0/dist/experiment.umd.js"></script>
  <style>
    [x-cloak] {
      display: none !important;
    }
    .copy-btn {
      height: 24px;
      position: absolute;
      top: 0.5rem;
      right: 0.5rem;
      z-index: 10;
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 0.25rem;
      opacity: 0.6;
      transition: opacity 0.2s;
    }
    
    .copy-btn:hover {
      opacity: 1;
    }
  </style>
  <script src="https://cdn.amplitude.com/script/8ec8f5cbeaf93a6717831a55add2d7a4.js"></script>
<script src="https://cdn.amplitude.com/script/8ec8f5cbeaf93a6717831a55add2d7a4.engagement.js"></script>

<script>
    window.amplitude.add(window.sessionReplay.plugin({
        sampleRate: 0.5
    }));
    window.amplitude.init('8ec8f5cbeaf93a6717831a55add2d7a4', {
        "fetchRemoteConfig": true,
        "autocapture": {
            "attribution": {
                "excludeInternalReferrers": true,
            },
            "pageViews": true,
            "sessions": true,
            "formInteractions": true,
            "fileDownloads": true,
            "elementInteractions": true,
            "pageUrlEnrichment": true,
            "webVitals": true,
        },
    });
     
    window.amplitude.add(window.engagement.plugin())
    
    function checkAuthenticatedUser() {
        try {
            const AMP_PREFIX = 'AMP_';
            const currUserId = amplitude.getUserId();

            if (!currUserId) {
                // Iterate through all amplitude cookies within amplitude domain
                const amplitudeCookies = getCookies(AMP_PREFIX);

                for (let [cookieName, cookieValue] of amplitudeCookies.map((cookies) => cookies.split('='))) {
                    const [deviceId, userId] = cookieValue.split('.');
    
                    try {
                        const userSession = JSON.parse(decodeURIComponent(atob(cookieValue)))
                        if (userSession && userSession.userId) {
                            amplitude.setUserId(userSession.userId);
                            break;
                        }
                    } catch {}
                }
            }
        } catch (e) {
            console.error(e);
        }
    }

    function getCookies(prefix) {
        try {
            const cookieArray = document.cookie.split(';').map((c) => c.trimStart());
            let values = [];
            for (let cookie of cookieArray) {
                while (cookie.charAt(0) === ' ') {
                    cookie = cookie.substring(1);
                }
                if (cookie.startsWith(prefix)) {
                    values.push(cookie.substring(name.length));
                }
            }
            return values;
        } catch (e) {
            return [];
        }
    }

    document.addEventListener("DOMContentLoaded", function () {
        checkAuthenticatedUser();
    });
</script>
<script>
    function academyClick(link) {
        amplitude.track('Academy link', {
            'destination': link,
            '[Amplitude] Page URL': window.location.href
        })
    }
</script>
<!-- Preload consolidated glossary data -->


</head>
<body class="bg-gray-100 font-sans leading-normal text-gray-800 scroll-pt-24">
  <div x-data="{ sidebarOpen: false }" class="container prose">
    <div class="top-0 left-0  right-0 bg-white fixed z-10">
      <div class="w-full pt-5 pl-5">
        <div class="box-border">
          

<div class="box-border flex flex-row flex-nowrap items-center border-solid border-b border-black-200 h-12 px-4"
    style="margin-left: -20px; margin-top: -20px;">
    <div class="flex-auto mr-4"><a class="no-underline" href="/docs"><svg class="inline" xmlns="http://www.w3.org/2000/svg" width="102" height="22" viewBox="0 0 102 22" fill="none"><path d="M29.6006 4.30664L24.9824 15.8083H27.0328L27.9448 13.5064H32.8375L33.7338 15.8083H35.8324L31.222 4.30664H29.6006ZM28.6561 11.6698L30.3916 7.26636L32.1114 11.6698H28.6561Z" fill="#1E61F0"/><path d="M46.3273 7.61133C45.7724 7.61133 45.2618 7.7384 44.7934 7.99253C44.3251 8.24667 43.9778 8.59073 43.7515 9.02276C43.2724 8.08148 42.4381 7.61133 41.2486 7.61133C40.7695 7.61133 40.3081 7.71396 39.8643 7.9202C39.4206 8.12644 39.0615 8.45682 38.787 8.91036V7.77945H36.9541V15.8082H38.787V11.308C38.787 10.6668 38.9631 10.183 39.3153 9.85653C39.6676 9.53006 40.0916 9.36683 40.5865 9.36683C41.1355 9.36683 41.5684 9.53886 41.8862 9.8839C42.2039 10.2289 42.3623 10.703 42.3623 11.3071V15.8072H44.211V11.3071C44.211 10.6659 44.3861 10.182 44.7354 9.85555C45.0857 9.52908 45.5107 9.36585 46.0115 9.36585C46.5545 9.36585 46.9825 9.53788 47.2954 9.88292C47.6073 10.228 47.7637 10.702 47.7637 11.3061V15.8063H49.637V10.8975C49.637 9.89758 49.332 9.099 48.721 8.50276C48.11 7.90945 47.3121 7.61133 46.3273 7.61133Z" fill="#1E61F0"/><path d="M58.0913 8.17238C57.502 7.79802 56.8546 7.61133 56.1492 7.61133C55.5038 7.61133 54.9351 7.75013 54.4462 8.0287C53.9562 8.30727 53.5626 8.70509 53.2675 9.22412V7.78043H51.4346V18.6164H53.2675V14.3655C53.5636 14.8787 53.9562 15.2745 54.4462 15.5521C54.9361 15.8307 55.5038 15.9695 56.1492 15.9695C57.2206 15.9695 58.1297 15.5639 58.8784 14.7545C59.6261 13.9442 60 12.959 60 11.7987C60 11.0392 59.8288 10.3394 59.4874 9.6972C59.146 9.05502 58.6807 8.54675 58.0913 8.17238ZM57.4813 13.5181C57.0081 13.9911 56.4296 14.2277 55.7458 14.2277C55.0355 14.2277 54.4442 13.995 53.9739 13.5298C53.5026 13.0645 53.2675 12.4868 53.2675 11.7968C53.2675 11.0959 53.5026 10.5134 53.9739 10.0481C54.4452 9.58284 55.0355 9.35021 55.7458 9.35021C56.4296 9.35021 57.0081 9.58675 57.4813 10.0598C57.9556 10.5329 58.1917 11.1116 58.1917 11.7968C58.1927 12.4722 57.9556 13.045 57.4813 13.5181Z" fill="#1E61F0"/><path d="M63.287 4.30664H61.4541V15.8083H63.287V4.30664Z" fill="#1E61F0"/><path d="M66.9003 7.7793H65.0674V15.8081H66.9003V7.7793Z" fill="#1E61F0"/><path d="M65.996 4.04883C65.6733 4.04883 65.3959 4.16417 65.1647 4.39387C64.9335 4.62357 64.8174 4.89628 64.8174 5.21199C64.8174 5.53846 64.9325 5.81606 65.1647 6.04673C65.3959 6.27643 65.6733 6.39177 65.996 6.39177C66.3187 6.39177 66.5982 6.27643 66.8323 6.04673C67.0665 5.81703 67.1836 5.53846 67.1836 5.21199C67.1836 4.89628 67.0665 4.62357 66.8323 4.39387C66.5972 4.16417 66.3187 4.04883 65.996 4.04883Z" fill="#1E61F0"/><path d="M71.4538 5.62109H69.6051V7.77832H68.0713V9.51916H69.6051V12.7838C69.6051 13.7838 69.8737 14.554 70.4129 15.0936C70.951 15.6341 71.6751 15.9039 72.5842 15.9039C72.961 15.9039 73.2926 15.8716 73.5769 15.8071V14.1151C73.4107 14.1581 73.2109 14.1796 72.9797 14.1796C72.5055 14.1796 72.1336 14.0633 71.8621 13.8307C71.5905 13.5981 71.4538 13.2384 71.4538 12.7516V9.51916H73.5769V7.77832H71.4538V5.62109Z" fill="#1E61F0"/><path d="M80.6484 12.127C80.6484 12.7574 80.4673 13.2628 80.1033 13.643C79.7403 14.0223 79.2602 14.2129 78.662 14.2129C78.0697 14.2129 77.5935 14.0232 77.2324 13.643C76.8714 13.2638 76.6913 12.7584 76.6913 12.127V7.7793H74.8584V12.343C74.8584 13.471 75.1575 14.3575 75.7547 15.0017C76.3519 15.6458 77.1724 15.9684 78.2173 15.9684C78.7505 15.9684 79.2238 15.8452 79.638 15.5989C80.0522 15.3535 80.3886 15.0007 80.6474 14.5403V15.8081H82.496V7.7793H80.6474V12.127H80.6484Z" fill="#1E61F0"/><path d="M90.6406 9.19095C90.3445 8.68268 89.9549 8.29268 89.4699 8.01997C88.9858 7.74726 88.423 7.61139 87.7826 7.61139C87.0771 7.61139 86.4288 7.79613 85.8375 8.16463C85.2452 8.53313 84.7769 9.03847 84.4325 9.68065C84.0882 10.3228 83.916 11.0227 83.916 11.7822C83.916 12.5416 84.0882 13.2435 84.4325 13.8876C84.7769 14.5317 85.2452 15.04 85.8375 15.4114C86.4298 15.7829 87.0781 15.9686 87.7826 15.9686C88.423 15.9686 88.9858 15.8337 89.4699 15.5629C89.9539 15.2932 90.3445 14.9041 90.6406 14.3959V15.8073H92.4982V4.30664H90.6406V9.19095ZM89.9352 13.5269C89.464 13.9951 88.8786 14.2287 88.1791 14.2287C87.4953 14.2287 86.9168 13.9922 86.4435 13.5191C85.9693 13.046 85.7332 12.4674 85.7332 11.7822C85.7332 11.1087 85.9703 10.5349 86.4435 10.0619C86.9168 9.58877 87.4953 9.35223 88.1791 9.35223C88.8786 9.35223 89.464 9.58486 89.9352 10.0501C90.4065 10.5154 90.6416 11.0931 90.6416 11.7831C90.6406 12.4771 90.4055 13.0587 89.9352 13.5269Z" fill="#1E61F0"/><path d="M102 11.6218C102 10.8574 101.822 10.1664 101.466 9.54863C101.111 8.93088 100.633 8.45389 100.033 8.11667C99.4327 7.77945 98.7716 7.61133 98.0504 7.61133C97.286 7.61133 96.5854 7.79313 95.9469 8.15674C95.3094 8.52036 94.8057 9.01885 94.4367 9.65224C94.0678 10.2856 93.8838 10.9855 93.8838 11.7498C93.8838 12.5357 94.0678 13.2522 94.4367 13.8993C94.8057 14.5463 95.3104 15.0526 95.9509 15.4192C96.5914 15.7857 97.3017 15.9685 98.0829 15.9685C99.0785 15.9685 99.9256 15.7114 100.626 15.1983C101.326 14.6851 101.751 14.0058 101.902 13.1613H100.054C99.9729 13.5034 99.7535 13.782 99.3953 13.995C99.0372 14.2091 98.6112 14.3156 98.1153 14.3156C97.4749 14.3156 96.9505 14.1446 96.5412 13.8025C96.1319 13.4604 95.8682 12.9902 95.7502 12.3911H101.95C101.984 12.2474 102 11.9903 102 11.6218ZM95.7993 10.8271C95.9341 10.3345 96.189 9.95232 96.5668 9.67961C96.9436 9.4069 97.403 9.27006 97.9471 9.27006C98.4961 9.27006 98.9546 9.41374 99.3235 9.69916C99.6925 9.98555 99.9168 10.3609 99.9975 10.8262H95.7993V10.8271Z" fill="#1E61F0"/><path d="M9.3659 5.25304C9.30588 5.1768 9.24193 5.13477 9.16519 5.13477C9.1101 5.13868 9.05894 5.15627 9.01171 5.18559C8.44403 5.62642 7.6717 7.49628 7.03613 9.96336L7.59988 9.96727C8.70967 9.97998 9.85684 9.99269 10.9883 10.0093C10.6892 8.88133 10.4078 7.91463 10.1481 7.13072C9.76731 5.99101 9.51151 5.47785 9.3659 5.25304Z" fill="#1E61F0"/><path d="M10.6256 0.5C4.75792 0.5 0 5.22694 0 11.0564C0 16.886 4.75792 21.6129 10.6256 21.6129C16.4933 21.6129 21.2512 16.886 21.2512 11.0564C21.2512 5.22694 16.4933 0.5 10.6256 0.5ZM18.4689 10.9294C18.4394 11.0477 18.3666 11.163 18.2643 11.247C18.2515 11.2558 18.2387 11.2637 18.2259 11.2725L18.2131 11.2813L18.1875 11.2979L18.1659 11.3106C18.0852 11.3526 17.9947 11.3741 17.9012 11.3741H12.8659C12.9042 11.5393 12.9514 11.7299 12.9977 11.9342C13.2751 13.1169 14.0052 16.2623 14.7853 16.2623H14.8021H14.8109H14.8277C15.4337 16.2623 15.7456 15.3895 16.4284 13.4766L16.4372 13.4551C16.5484 13.1501 16.6724 12.8022 16.8042 12.4337L16.8386 12.3408C16.8898 12.2177 17.0305 12.1541 17.1545 12.2049C17.244 12.2392 17.3079 12.3281 17.3079 12.4259C17.3079 12.4513 17.304 12.4728 17.2991 12.4933L17.2696 12.5862C17.1968 12.8149 17.125 13.1247 17.0344 13.4854C16.6291 15.1559 16.0142 17.6787 14.444 17.6787H14.4312C13.4158 17.6699 12.8098 16.059 12.549 15.368C12.063 14.0787 11.696 12.7093 11.3419 11.379H6.71677L5.75653 14.4355L5.74374 14.4228C5.59911 14.6476 5.29608 14.715 5.0698 14.5714C4.92911 14.4824 4.84351 14.3299 4.84351 14.1647V14.1481L4.90353 13.8001C5.03536 13.0162 5.1977 12.1971 5.37676 11.3751H3.41397L3.40512 11.3663C3.0037 11.3067 2.72626 10.9343 2.78627 10.5355C2.8335 10.2256 3.07257 9.98028 3.37954 9.92456C3.45628 9.91576 3.53302 9.91185 3.60976 9.91576H3.70322C4.32207 9.92456 4.97928 9.93727 5.70438 9.94509C6.72464 5.82416 7.90625 3.72949 9.22067 3.72558C10.6286 3.72558 11.6744 6.90913 12.5107 10.0252L12.5146 10.0379C14.2305 10.0722 16.0653 10.123 17.8441 10.2501L17.9209 10.2588C17.9504 10.2588 17.976 10.2628 18.0065 10.2676H18.0153L18.0242 10.2716H18.0281C18.3321 10.3312 18.5328 10.6283 18.4689 10.9294Z" fill="#1E61F0"/></svg> <span class="hidden md:inline text-xs uppercase text-black-600 ml-2">documentation</span></a></div>
    <div id="algolia-search-header"></div>
</div>

        </div>
      </div>

    </div>
    <div class="top-12 left-0 right-0 fixed bg-white z-10">
      <div class="w-full overflow-scroll md:overflow-auto pt-5 pl-5">
        <div class="box-border">
          
<div class="box-border flex flex-row flex-nowrap items-center border-solid border-b border-black-200 h-12 px-4 justify-start"
    style="margin-left: -20px; margin-top: -20px;">
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/get-started">Get Started</a></div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/data">Data</a></div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/analytics">Analytics</a></div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/amplitude-ai">Amplitude AI</a></div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/session-replay">Session Replay</a></div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/guides-and-surveys">Guides and Surveys</a></div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/assistant">AI Assistant</a></div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/experiment-home">Experiment</a></div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/admin">Admin</a></div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 inline w-max" x-data="{ open: false }"><button
                 @click="open = !open" class="font-normal -mb-[11px] text-[#111827]">Developers <svg class="inline fill-[#111827]" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none"><g id="icon-chevron-down"><path id="Vector" d="M10.25 10.6338L13.8837 7L15 8.11625L10.25 12.8663L5.5 8.11625L6.61625 7L10.25 10.6338Z" fill="#5A5E68"/></g></svg></button>
                <div x-cloak x-show="open" x-transition @click.outside="open = false" class="mt-4 py-2 right-4 sm:right-auto absolute border border-amp-gray-100 rounded flex flex-col shadow-lg top-4 bg-white w-48 p-4 font-normal z-20">
                    
                        <a class="no-underline pl-4 py-2 font-light hover:bg-amp-blue-950 hover:rounded" href="/docs/sdks">SDKs</a>
                    
                        <a class="no-underline pl-4 py-2 font-light hover:bg-amp-blue-950 hover:rounded" href="/docs/apis">APIs</a>
                    
                </div>
            </div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/partners">Partners</a></div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/faq">FAQ</a></div>
        
    
</div>


        </div>
      </div>

    </div>
    
      <div
        class="w-64 top-24 bg-white bottom-0 border-solid border-r border-black-200 -left-60 lg:left-0 lg:translate-x-0 lg:block z-10 fixed transition shadow overflow-visible lg:overflow-auto lg:overscroll-contain" :class="{ 'translate-x-[240px]': sidebarOpen }">
        <button @click="sidebarOpen = !sidebarOpen" class="absolute lg:hidden left-0 z-50 w-4 translate-x-[245px] translate-y-8" :class="{ 'rotate-180': sidebarOpen, 'translate-x-[250px]' : sidebarOpen }"><svg xmlns="http://www.w3.org/2000/svg" width="21" height="24" viewBox="0 0 21 24" fill="none"><rect x="0.5" y="0.5" width="20" height="23" rx="3.5" fill="white"/><rect x="0.5" y="0.5" width="20" height="23" rx="3.5" stroke="#DEDFE2"/><g clip-path="url(#clip0_671_1270)"><path d="M11.007 11.8L8.09998 8.893L8.99298 8L12.793 11.8L8.99298 15.6L8.09998 14.707L11.007 11.8Z" fill="#1E2024"/></g><defs><clipPath id="clip0_671_1270"><rect width="16" height="16" fill="white" transform="translate(2.5 4)"/></clipPath></defs></svg></button>
        <div class="h-full overflow-scroll overscroll-contain">
  
  <amp-side-nav current-uri="/docs/sdks/analytics/ios" nav-title="analytics_sdks">
    
      
      
        
        <amp-nav-item 
          title="Analytics SDKs" 
          url="/docs/sdks/analytics" 
          slug="analytics-sdks"
          level="1"
          >
        </amp-nav-item>

      
    
      
      
        
        <amp-nav-item 
          title="Browser" 
          slug="browser"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Browser Unified SDK" 
                  url="/docs/sdks/analytics/browser/browser-unified-sdk" 
                  slug="browser-unified-sdk"
                  parent-slug="browser"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Browser SDK 2" 
                  slug="browser-sdk-2"
                  parent-slug="browser"
                  has-children
                  level="2">
                  
                    
                    <amp-nav-item 
                      title="Browser SDK 2" 
                      url="/docs/sdks/analytics/browser/browser-sdk-2" 
                      slug="browser-sdk-2"
                      parent-slug="browser-sdk-2"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Ampli for Browser SDK 2.0" 
                      url="/docs/sdks/analytics/browser/ampli-for-browser-sdk-2-0" 
                      slug="ampli-for-browser-sdk-20"
                      parent-slug="browser-sdk-2"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Migrate from Browser SDK 1.0 to 2.0" 
                      url="/docs/sdks/analytics/browser/migrate-from-browser-sdk-1-0-to-2-0" 
                      slug="migrate-from-browser-sdk-10-to-20"
                      parent-slug="browser-sdk-2"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Cookies and consent management (Browser SDK)" 
                      url="/docs/sdks/analytics/browser/cookies-and-consent-management" 
                      slug="cookies-and-consent-management-browser-sdk"
                      parent-slug="browser-sdk-2"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Autocapture Plugin" 
                  url="/docs/sdks/analytics/browser/autocapture-plugin" 
                  slug="autocapture-plugin"
                  parent-slug="browser"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Browser SDK 1" 
                  slug="browser-sdk-1"
                  parent-slug="browser"
                  has-children
                  level="2">
                  
                    
                    <amp-nav-item 
                      title="Browser SDK 1" 
                      url="/docs/sdks/analytics/browser/browser-sdk-1" 
                      slug="browser-sdk-1"
                      parent-slug="browser-sdk-1"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Ampli for Browser SDK 1.0" 
                      url="/docs/sdks/analytics/browser/ampli-for-browser-sdk-1-0" 
                      slug="ampli-for-browser-sdk-10"
                      parent-slug="browser-sdk-1"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Android" 
          slug="android"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Android-Kotlin SDK" 
                  url="/docs/sdks/analytics/android/android-kotlin-sdk" 
                  slug="android-kotlin-sdk"
                  parent-slug="android"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Ampli for Android-Kotlin SDK" 
                  url="/docs/sdks/analytics/android/ampli-for-android-kotlin-sdk" 
                  slug="ampli-for-android-kotlin-sdk"
                  parent-slug="android"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Node" 
          slug="node"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Node.js SDK" 
                  url="/docs/sdks/analytics/node/node-js-sdk" 
                  slug="nodejs-sdk"
                  parent-slug="node"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Node.js Ampli Wrapper" 
                  url="/docs/sdks/analytics/node/node-js-ampli-wrapper" 
                  slug="nodejs-ampli-wrapper"
                  parent-slug="node"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Go" 
          slug="go"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Go SDK" 
                  url="/docs/sdks/analytics/go/go-sdk" 
                  slug="go-sdk"
                  parent-slug="go"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Ampli for Go" 
                  url="/docs/sdks/analytics/go/ampli-for-go" 
                  slug="ampli-for-go"
                  parent-slug="go"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Python" 
          slug="python"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Python SDK" 
                  url="/docs/sdks/analytics-sdks/python/python-sdk" 
                  slug="python-sdk"
                  parent-slug="python"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Ampli for Python SDK" 
                  url="/docs/sdks/analytics-sdks/python/ampli-for-python-sdk" 
                  slug="ampli-for-python-sdk"
                  parent-slug="python"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="iOS" 
          slug="ios"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="iOS Swift SDK" 
                  url="/docs/sdks/analytics/ios/ios-swift-sdk" 
                  slug="ios-swift-sdk"
                  parent-slug="ios"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Ampli for iOS Swift SDK" 
                  url="/docs/sdks/analytics/ios/ampli-for-ios-swift-sdk" 
                  slug="ampli-for-ios-swift-sdk"
                  parent-slug="ios"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Unified SDK for Swift" 
                  url="/docs/sdks/analytics/ios/unified-sdk" 
                  slug="unified-sdk-for-swift"
                  parent-slug="ios"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Flutter" 
          slug="flutter"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Flutter SDK 3" 
                  url="/docs/sdks/analytics/flutter/flutter-sdk" 
                  slug="flutter-sdk-3"
                  parent-slug="flutter"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Flutter SDK 4" 
                  url="/docs/sdks/analytics/flutter/flutter-sdk-4" 
                  slug="flutter-sdk-4"
                  parent-slug="flutter"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Flutter SDK 4.0 Migration Guide" 
                  url="/docs/sdks/analytics/flutter/flutter-sdk-4-0-migration-guide" 
                  slug="flutter-sdk-40-migration-guide"
                  parent-slug="flutter"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Java" 
          slug="java"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="JRE Java SDK" 
                  url="/docs/sdks/analytics/java/jre-java-sdk" 
                  slug="jre-java-sdk"
                  parent-slug="java"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Ampli for Java SDK" 
                  url="/docs/sdks/analytics/java/ampli-for-java-sdk" 
                  slug="ampli-for-java-sdk"
                  parent-slug="java"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="React Native" 
          slug="react-native"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="React Native SDK" 
                  url="/docs/sdks/analytics/react-native/react-native-sdk" 
                  slug="react-native-sdk"
                  parent-slug="react-native"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Migrate to the latest React Native SDK" 
                  url="/docs/sdks/analytics/react-native/migrate-to-the-latest-react-native-sdk" 
                  slug="migrate-to-the-latest-react-native-sdk"
                  parent-slug="react-native"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Ampli for the React Native SDK" 
                  url="/docs/sdks/analytics/react-native/ampli-for-the-react-native-sdk" 
                  slug="ampli-for-the-react-native-sdk"
                  parent-slug="react-native"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Unreal" 
          slug="unreal"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Unreal SDK" 
                  url="/docs/sdks/analytics/unreal/unreal-sdk" 
                  slug="unreal-sdk"
                  parent-slug="unreal"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Unity" 
          slug="unity"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Unity SDK" 
                  url="/docs/sdks/analytics/unity/unity-sdk" 
                  slug="unity-sdk"
                  parent-slug="unity"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Maintenance SDKs" 
          slug="maintenance-sdks"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Marketing Analytics SDK" 
                  slug="marketing-analytics-sdk"
                  parent-slug="maintenance-sdks"
                  has-children
                  level="2">
                  
                    
                    <amp-nav-item 
                      title="Marketing Analytics SDK" 
                      url="/docs/sdks/analytics/browser/marketing-analytics-sdk" 
                      slug="marketing-analytics-sdk"
                      parent-slug="marketing-analytics-sdk"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Migrate from Marketing Analytics to Browser SDK 2.0" 
                      url="/docs/sdks/analytics/browser/migrate-from-marketing-analytics-to-browser-sdk-2-0" 
                      slug="migrate-from-marketing-analytics-to-browser-sdk-20"
                      parent-slug="marketing-analytics-sdk"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Javascript SDK" 
                  slug="javascript-sdk"
                  parent-slug="maintenance-sdks"
                  has-children
                  level="2">
                  
                    
                    <amp-nav-item 
                      title="Javascript SDK" 
                      url="/docs/sdks/analytics/browser/javascript-sdk" 
                      slug="javascript-sdk"
                      parent-slug="javascript-sdk"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Ampli for Javascript SDK" 
                      url="/docs/sdks/analytics/browser/ampli-for-javascript-sdk" 
                      slug="ampli-for-javascript-sdk"
                      parent-slug="javascript-sdk"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Migrate from Javascript SDK to Browser SDK 1.0" 
                      url="/docs/sdks/analytics/browser/migrate-from-javascript-sdk-to-browser-sdk-1-0" 
                      slug="migrate-from-javascript-sdk-to-browser-sdk-10"
                      parent-slug="javascript-sdk"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Migrate from Javascript SDK to Browser SDK 2.0" 
                      url="/docs/sdks/analytics/browser/migrate-from-javascript-sdk-to-browser-sdk-2-0" 
                      slug="migrate-from-javascript-sdk-to-browser-sdk-20"
                      parent-slug="javascript-sdk"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Cookies and Consent Management (JavaScript SDK)" 
                      url="/docs/sdks/analytics/browser/cookies-and-consent-management-javascript-sdk" 
                      slug="cookies-and-consent-management-javascript-sdk"
                      parent-slug="javascript-sdk"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="React Native SDK (maintenance)" 
                  url="/docs/sdks/analytics/react-native/react-native-sdk-maintenance" 
                  slug="react-native-sdk-maintenance"
                  parent-slug="maintenance-sdks"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="iOS SDK" 
                  url="/docs/sdks/analytics/ios/ios-sdk" 
                  slug="ios-sdk"
                  parent-slug="maintenance-sdks"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Node SDK" 
                  slug="node-sdk"
                  parent-slug="maintenance-sdks"
                  has-children
                  level="2">
                  
                    
                    <amp-nav-item 
                      title="Node SDK" 
                      url="/docs/sdks/analytics/node/node-sdk" 
                      slug="node-sdk"
                      parent-slug="node-sdk"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Ampli for Node SDK" 
                      url="/docs/sdks/analytics/node/ampli-for-node-sdk" 
                      slug="ampli-for-node-sdk"
                      parent-slug="node-sdk"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Node.js SDK Migration Guide" 
                      url="/docs/sdks/analytics/node/node-js-sdk-migration-guide" 
                      slug="nodejs-sdk-migration-guide"
                      parent-slug="node-sdk"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Android SDK 1.0" 
                  slug="android-sdk-10"
                  parent-slug="maintenance-sdks"
                  has-children
                  level="2">
                  
                    
                    <amp-nav-item 
                      title="Android SDK" 
                      url="/docs/sdks/analytics/android/android-sdk" 
                      slug="android-sdk"
                      parent-slug="android-sdk-10"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Migrate to the Android-Kotlin SDK" 
                      url="/docs/sdks/analytics/android/migrate-to-the-android-kotlin-sdk" 
                      slug="migrate-to-the-android-kotlin-sdk"
                      parent-slug="android-sdk-10"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
  </amp-side-nav>

</div>    
        
      </div>
      <div class="absolute top-24 left-0 lg:left-64 bottom-0 right-0 z-0 transition">
        <div class="max-w-screen-xl pt-8 mx-auto">
          <section class="w-full flex flex-col items-center">
    <div class="flex flex-row flex-nowrap w-full text-sm pl-6 lg:pl-8 text-gray-400">
    
    <div class="mr-2 text-s text-gray-500 "><a class=""
        href="/docs/sdks">SDKs</a></div>
    <span class="mr-2">/</span><div class="mr-2 text-s text-gray-500 "><a class=""
        href="/docs/sdks/analytics">Amplitude Analytics SDK Catalog</a></div>
    <span class="mr-2">/</span><div class="mr-2 text-s text-gray-500 "><a class="font-semibold"
        href="/docs/sdks/analytics/ios">iOS</a></div>
    
    
</div>
    <div class="w-full p-8">
        <div class="copy">
            <div class="flex flex-row items-start justify-between">
                <h1>iOS</h1>
                
            </div>
            <div class="flex flex-wrap gap-4 w-full max-w-screen-xl">
                
                    <div class="flex-1 basis-80 border border-amp-gray-200 grow-0 rounded p-4 hover:shadow transition">
                        <code class="text-xs mb-2 inline-block current">current</code>
                        <a href="/docs/sdks/analytics/ios/ios-swift-sdk">
                            <h2 class="text-md font-Gellix my-0 flex flex-row content-center items-start">
                                
                                    <img class="h-6 rounded-sm inline mr-1 my-0" src="/docs/assets/icons/swift.svg" />
                                
                                    <img class="h-6 rounded-sm inline mr-1 my-0" src="/docs/assets/icons/obj-c.svg" />
                                
                                <span class="ml-2">iOS Swift SDK</span>
                            </h2>
                        </a>
                        <div class="inline"><a href="https://cocoapods.org/pods/AmplitudeSwift" target="_blank"><img class="my-0 inline"
                                    src="" alt="" srcset="" /></a>
                        </div>
                        <ul class="text-sm">
                            <li><a href="https://github.com/amplitude/Amplitude-Swift" target="_blank">GitHub</a></li>
                            <li><a href="https://github.com/amplitude/Amplitude-Swift/releases" target="_blank">Releases</a></li>
                            
                                
                                    <li><a href="/docs/sdks/analytics/ios/ampli-for-ios-swift-sdk">Ampli</a></li>
                                
                            
                            
                                
                                    <li><a href="/docs/sdks/analytics/ios/ios-sdk-migration-guide">iOS SDK Migration Guide</a></li>
                                
                            
                            
                            
                        </ul>
                    </div>
                
                    <div class="flex-1 basis-80 border border-amp-gray-200 grow-0 rounded p-4 hover:shadow transition">
                        <code class="text-xs mb-2 inline-block current">current</code>
                        <a href="/docs/sdks/analytics/ios/unified-sdk">
                            <h2 class="text-md font-Gellix my-0 flex flex-row content-center items-start">
                                
                                    <img class="h-6 rounded-sm inline mr-1 my-0" src="/docs/assets/icons/swift.svg" />
                                
                                    <img class="h-6 rounded-sm inline mr-1 my-0" src="/docs/assets/icons/obj-c.svg" />
                                
                                <span class="ml-2">Unified SDK for Swift</span>
                            </h2>
                        </a>
                        <div class="inline"><a href="https://cocoapods.org/pods/AmplitudeUnified" target="_blank"><img class="my-0 inline"
                                    src="" alt="" srcset="" /></a>
                        </div>
                        <ul class="text-sm">
                            <li><a href="https://github.com/amplitude/AmplitudeUnified-Swift" target="_blank">GitHub</a></li>
                            <li><a href="https://github.com/amplitude/AmplitudeUnified-Swift/releases" target="_blank">Releases</a></li>
                            
                            
                            
                            
                        </ul>
                    </div>
                
                    <div class="flex-1 basis-80 border border-amp-gray-200 grow-0 rounded p-4 hover:shadow transition">
                        <code class="text-xs mb-2 inline-block maintenance">maintenance</code>
                        <a href="/docs/sdks/analytics/ios/ios-sdk">
                            <h2 class="text-md font-Gellix my-0 flex flex-row content-center items-start">
                                
                                    <img class="h-6 rounded-sm inline mr-1 my-0" src="/docs/assets/icons/swift.svg" />
                                
                                    <img class="h-6 rounded-sm inline mr-1 my-0" src="/docs/assets/icons/obj-c.svg" />
                                
                                <span class="ml-2">iOS SDK</span>
                            </h2>
                        </a>
                        <div class="inline"><a href="https://cocoapods.org/pods/Amplitude-iOS" target="_blank"><img class="my-0 inline"
                                    src="" alt="" srcset="" /></a>
                        </div>
                        <ul class="text-sm">
                            <li><a href="https://github.com/amplitude/Amplitude-iOS" target="_blank">GitHub</a></li>
                            <li><a href="https://github.com/amplitude/Amplitude-iOS/releases" target="_blank">Releases</a></li>
                            
                            
                            
                            
                        </ul>
                    </div>
                
            </div>
        </div>
</section>
        </div>
      </div>
    
  </div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/tocbot/4.25.0/tocbot.min.js"></script>
    <script>

      // Get all h2 and h3 elements
      var headings = document.querySelectorAll('h2, h3');
  
      // Check if there are more than 3
      if (headings.length > 2) {
        // Execute your code here
        tocbot.init({
          // Where to render the table of contents.
          tocSelector: '.js-toc',
          // Where to grab the headings to build the table of contents.
          contentSelector: '.prose',
          // Which headings to grab inside of the contentSelector element.
          headingSelector: 'h2, h3',
          // For headings inside relative or absolute positioned containers within content.
          hasInnerContainers: true,
          ignoreSelector: '.hint-title, .js-toc-ignore',
          orderedList: false,
          ignoreHiddenElements: true,
          headingsOffset: 96,
          scrollSmoothOffset: -96
        });    }
     
    </script>

    
  
<script src="https://cdn.jsdelivr.net/npm/@docsearch/js@4"></script>
<script type="text/javascript">
  docsearch({
    appId: "93SYI9HL20",
    apiKey: "105a5cad34a7ac8f6a9fb78189d9c113",
    indexName: "amplitude-vercel",
    container: '#algolia-search-header',
    debug: true,
    placeholder: "Search 'instrumentation' , 'Export API'",
    transformItems(items) {
      return items.map((item) => ({
        ...item,
        url: item.url.replace('https://amplitude.com','')
      }))
    }
  });

  // Amplitude tracking for DocSearch
  (function() {
    var lastQuery = '';
    var searchOpen = false;

    document.addEventListener('click', function(e) {
      if (e.target.closest('.DocSearch-Button')) {
        amplitude.track('Search opened');
        searchOpen = true;
      }
    });

    document.addEventListener('input', function(e) {
      var input = document.querySelector('.DocSearch-Input');
      if (input && e.target === input) {
        lastQuery = input.value;
      }
    });

    // Use capture phase to run before DocSearch closes the modal
    document.addEventListener('click', function(e) {
      var hit = e.target.closest('.DocSearch-Hit');
      if (hit) {
        var query = lastQuery; // Capture query before any DOM changes
        var link = hit.querySelector('a');
        var url = link ? link.getAttribute('href') : '';
        var hits = document.querySelectorAll('.DocSearch-Hit');
        var position = Array.prototype.indexOf.call(hits, hit) + 1;
        amplitude.track('Search result clicked', { query: query, url: url, position: position });
      }
    }, true);

    var observer = new MutationObserver(function(mutations) {
      var modal = document.querySelector('.DocSearch-Modal');
      if (searchOpen && !modal) {
        if (lastQuery) {
          amplitude.track('Search query', { query: lastQuery });
        }
        lastQuery = '';
        searchOpen = false;
      } else if (modal && !searchOpen) {
        // Track search opened for keyboard shortcuts (Cmd+K/Ctrl+K)
        amplitude.track('Search opened');
        searchOpen = true;
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  })();
</script>
<script src="/docs/js/site.js?id=078a82617f7dafffff92da951b4ec6c9"></script>
<script src="/docs/js/statuspage.js?id=4da5c29a14b085ee38c353c2a7b7713c"></script>

<!-- Latest Version -->
<script src="https://cc.cdn.civiccomputing.com/9/cookieControl-9.x.min.js" type="text/javascript"></script>
<script>
    var config = {
            apiKey: "106b5e962520ab454786a0d1ba709e47372ef512",
            product: "PRO_MULTISITE",
            initialState: 'notify',
            notifyDismissButton: false,
            theme: 'light',
            setInnerHTML: true,
            branding: {
                fontFamily: 'IBM Plex Sans, sans-serif',
                backgroundColor: '#fafcfe',
                removeIcon: true,
                removeAbout: true,
            },
            statement: {
                description: 'See our',
                name: 'Privacy Notice',
                url: 'https://amplitude.com/privacy#cookies',
                updated: '25/04/2018',
            },

            ccpaConfig: {
                description: 'See our',
                name: 'Personal Information Notice',
                url: 'https://amplitude.com/privacy',
                updated: '25/04/2018',
            },

            ccpaConfig: {
                description: 'See our',
                name: 'Personal Information Notice',
                url: 'https://amplitude.com/privacy',
                updated: '25/04/2018',
            },
            text: {
                title: 'This site uses cookies.',
                intro: 'Some of these cookies are essential, while others help us to improve your experience by providing insights into how the site is being used.',
                necessaryTitle: 'Necessary Cookies',
                necessaryDescription: 'Necessary cookies enable core functionality. The website cannot function properly without these cookies, and can only be disabled by changing your browser preferences.',
                accept: 'Accept',
                reject: 'Reject',
                rejectSettings: "Do Not Sell or Share My Personal Information",

                // Regarding opening settings, "openCookieControl" should have been exposed
                // to the window by instrumentCookieControl() by, in the event it hasn't,
                // this falls back to CookieControl.open
                notifyDescription: `
		<div class="ccc-description">
			<div class="ccc-inner-description">
				<h2>Cookie Preferences</h2>
				<p>
					Sharing your cookies helps us improve site functionality and optimize your experience.
					<br><a href="https://amplitude.com/privacy#cookies" data-cta-clicked-type="interstitial" data-cc-policy>Click Here</a> to read our cookie policy.
				</p>
			</div>
			<div class="ccc-actions">
			<a class="ccc-manage-settings-btn" onclick="(window.openCookieControl || CookieControl.open)()"
					data-cta-clicked-type="interstitial"
					data-cc-settings>Manage Settings</a>
				<button onclick="CookieControl.acceptAll()" data-cc-accept data-cta-clicked-type="interstitial">
					Accept
				</button>
			</div>
		</div>`,
            },
            necessaryCookies: [
                '__utmzz', // utmz cookie replicator necessary to track utm google values
                '__utmzzses', // Also used by utmz cookie replciator
                'corp_utm', // Own cookie used to persist utm values for Marketo
                'membership_token_*', // Membership cookies for all access program
                'sj_csrftoken', // Skill Jar Cookie
            ],
            optionalCookies: [{
                    name: "performance",
                    label: "Performance Cookies",
                    description: 'We use these cookies to monitor and improve website performance.',
                    cookies: [
                        'amplitude_id*', // Amplitude SDK
                        'amp_*', // Newer Amplitude SDK
                        'AMP_*', // Newer Amplitude SDK
                        '1P_JAR', // Google Analytics
                        'DV', // Google Analytics
                        'NID', // Google Analytics
                        'OGPC', // Google Analytics
                        '_ga', // Google Analytics
                        '_gid', // Google Analytics
                        '_gat*', // Google Analytics
                    ],
                    onRevoke: function () {
                        amplitude.setOptOut(true)
                    }
                },
                {
                    name: "advertising",
                    label: "Advertising Cookies",
                    description: 'We use these cookies to help us improve the relevancy of advertising campaigns you receive.',
                    cookies: [
                        'BizoID', // LinkedIn
                        'UserMatchHistory', // LinkedIn
                        'lang', // LinkedIn
                        'bcookie', // LinkedIn
                        'bscookie', // LinkedIn
                        'lidc', // LinkedIn
                        'fr', // Facebook
                        'vc', // AddThis
                        'uvc', // AddThis
                        'uid', // AddThis
                        'loc', // AddThis
                        'ouid', // AddThis
                        'di2', // AddThis
                        '__atuvc', // AddThis
                        '__atuvs', // AddThis
                        '__d_mkto', // Marketo
                        '_mkto_trk', // Marketo
                        'BIGipServerab13web-app_https', // Marketo
                        'IDE', // Doubleclick,
                        'csv', // Reddit
                        'edgebucket', // Reddit
                        'loid', // Reddit
                        'over18', // Reddit
                        'recent_srs', // Reddit
                        'session_tracker', // Reddit
                        'token_v2', // Reddit
                        'IDE', // Doubleclick
                        '_uetsid', // Bing
                        '_uetvid', // Bing
                        '_uetsid_exp', // Bing
                        '_uetvid_exp', // Bing
                        '_uetmsclkid', // Bing
                        '_clsk', // Bing
                        'sa-user-id', // Stackadapt
                        'sa-user-id-v2', // Stackadapt
                    ],
                    onAccept: function () {

                    },
                    onRevoke: function () {

                    },
                }
            ]
    }

            CookieControl.load(config);
</script>

</body>
</html>