<?php
declare(strict_types=1);
ini_set('display_errors','0');
$private=__DIR__.'/.private';
header('X-Content-Type-Options: nosniff');header('Referrer-Policy: no-referrer');header('X-Frame-Options: DENY');header('Cache-Control: private, no-store, max-age=0');header('Pragma: no-cache');header('X-Robots-Tag: noindex, nofollow, noarchive');
$configPath=$private.'/config.json';
if(!is_file($configPath)){http_response_code(503);exit('Run setup first.');}
$siteConfig=json_decode(file_get_contents($configPath),true,512,JSON_THROW_ON_ERROR);
$origin=rtrim($siteConfig['origin']??'', '/');$parts=parse_url($origin);
$local=PHP_SAPI==='cli-server' && ($parts['scheme']??'')==='http' && in_array($parts['host']??'', ['127.0.0.1','localhost','[::1]'],true);
$expectedHost=($parts['host']??'').(isset($parts['port'])?':'.$parts['port']:'');
if(!$expectedHost || ($_SERVER['HTTP_HOST']??'')!==$expectedHost){http_response_code(403);exit('Forbidden');}
if(!$local){
 if(($parts['scheme']??'')!=='https'){http_response_code(503);exit('HTTPS configuration required.');}
 if(($_SERVER['HTTPS']??'')!=='on'){header('Location: '.$origin.'/',true,308);exit;}
 header('Strict-Transport-Security: max-age=31536000');
}
header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
$path=parse_url($_SERVER['REQUEST_URI']??'/',PHP_URL_PATH);$method=$_SERVER['REQUEST_METHOD']??'GET';
function respond(array $value,int $code=200):never{http_response_code($code);header('Content-Type: application/json; charset=utf-8');echo json_encode($value,JSON_THROW_ON_ERROR|JSON_UNESCAPED_UNICODE);exit;}
function html(string $value):string{return htmlspecialchars($value,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8');}
function ledger():array{
 global $private;$paths=glob($private.'/ledger-*.json')?:[];rsort($paths,SORT_STRING);
 foreach($paths as $file){$data=json_decode(file_get_contents($file),true);if(is_array($data)&&isset($data['transactions'],$data['accounts'],$data['meta']))return $data;}
 throw new RuntimeException('No published ledger is available');
}
try{
 $config=json_decode(file_get_contents($private.'/config.json'),true,512,JSON_THROW_ON_ERROR);
 require __DIR__.'/app/notes.php';
 if(!is_file($private.'/notes.sqlite'))throw new RuntimeException('Restore the authoritative notes database from backup.');
 $notes=new TransactionNotesStore($private.'/notes.sqlite');
 // A separate random service token is used only by the local publishing/review worker.
 $authorization=$_SERVER['HTTP_AUTHORIZATION']??$_SERVER['REDIRECT_HTTP_AUTHORIZATION']??'';
 $service=str_starts_with($authorization,'Bearer ')&&hash_equals($config['service_token'],substr($authorization,7));
 if(str_starts_with($path,'/api/sync/')){
  if(!$service)respond(['error'=>'Authentication required.'],401);
  if($path==='/api/sync/notes'&&$method==='GET')respond($notes->exportState());
  if($path==='/api/sync/notes'&&$method==='POST'){
   $body=json_decode(file_get_contents('php://input',false,null,0,32769),true,8,JSON_THROW_ON_ERROR);
   $reviewed=$body['reviewed']??false;if($reviewed!==true||($body['text']??null)!=='')respond(['error'=>'User notes can only be edited on the website.'],403);unset($body['reviewed']);
   [$id,$text,$version]=validateNoteRequest($body);$rows=array_column(ledger()['transactions'],null,'id');if(!isset($rows[$id]))respond(['error'=>'Transaction not found.'],404);
   respond(['transaction_id'=>$id,'note'=>$notes->save($id,$text,$version,$reviewed,'local-user')]);
  }
  respond(['error'=>'Not found.'],404);
 }
 ini_set('session.use_strict_mode','1');ini_set('session.use_only_cookies','1');ini_set('session.gc_maxlifetime','43200');session_name('expenses_session');session_set_cookie_params(['lifetime'=>0,'path'=>'/','secure'=>!$local,'httponly'=>true,'samesite'=>'Strict']);session_start();
 $_SESSION['csrf']??=bin2hex(random_bytes(32));
 if(isset($_SESSION['user'])&&(!isset($config['users'][$_SESSION['user']])||time()-($_SESSION['last_used']??0)>43200||time()-($_SESSION['signed_in']??0)>86400)){$_SESSION=[];session_regenerate_id(true);$_SESSION['csrf']=bin2hex(random_bytes(32));}
 $loggedIn=isset($_SESSION['user']);if($loggedIn)$_SESSION['last_used']=time();
 if($path==='/favicon.svg'||$path==='/login.css'){
  if(!in_array($method,['GET','HEAD'],true)){http_response_code(405);exit;}
  header('Content-Type: '.($path==='/login.css'?'text/css; charset=utf-8':'image/svg+xml'));if($method!=='HEAD')readfile(__DIR__.'/app/'.($path==='/login.css'?'login.css':'favicon.svg'));exit;
 }
 if($path==='/login'){
  if($loggedIn){header('Location: /',true,303);exit;}$error='';
  if($method==='POST'){
   if(!hash_equals($_SESSION['csrf'],$_POST['csrf']??'')){$error='This sign-in form expired. Please try again.';http_response_code(403);}
   else{
    $rate=new SQLite3($private.'/login-attempts.sqlite');$rate->busyTimeout(3000);$rate->exec('CREATE TABLE IF NOT EXISTS attempts (ip TEXT NOT NULL, at INTEGER NOT NULL)');$rate->exec('DELETE FROM attempts WHERE at<'.(time()-900));
    $ip=hash('sha256',$_SERVER['REMOTE_ADDR']??'');$query=$rate->prepare('SELECT COUNT(*) FROM attempts WHERE ip=:ip');$query->bindValue(':ip',$ip);$limited=(int)$query->execute()->fetchArray(SQLITE3_NUM)[0]>=10;
    $username=is_string($_POST['username']??null)?trim($_POST['username']):'';$password=is_string($_POST['password']??null)?$_POST['password']:'';
    $valid=password_verify(substr($password,0,4096),$config['users'][$username]??$config['dummy_hash']);
    if($valid&&!$limited&&isset($config['users'][$username])){session_regenerate_id(true);$_SESSION=['user'=>$username,'signed_in'=>time(),'last_used'=>time(),'csrf'=>bin2hex(random_bytes(32))];header('Location: /',true,303);exit;}
    $query=$rate->prepare('INSERT INTO attempts(ip,at) VALUES(:ip,:at)');$query->bindValue(':ip',$ip);$query->bindValue(':at',time(),SQLITE3_INTEGER);$query->execute();$rate->close();$error=$limited?'Too many sign-in attempts. Please wait 15 minutes.':'The username or password was not recognised.';http_response_code($limited?429:401);
   }
  }elseif(!in_array($method,['GET','HEAD'],true)){http_response_code(405);exit;}
  header('Content-Type: text/html; charset=utf-8');if($method==='HEAD')exit;
  echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · My expenses</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/login.css"></head><body><main class="login"><div class="login-brand"><img src="/favicon.svg" alt="" width="36" height="36"><span>My expenses</span></div><h1>Sign in</h1><p>Your household finances, in one place.</p>'.($error?'<p class="error" role="alert">'.html($error).'</p>':'').'<form method="post" action="/login"><input type="hidden" name="csrf" value="'.html($_SESSION['csrf']).'"><label for="username">Username</label><input id="username" name="username" autocomplete="username" required maxlength="100" autofocus><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="4096"><button type="submit">Sign in</button></form></main></body></html>';exit;
 }
 if(!$loggedIn){if(str_starts_with($path,'/api/'))respond(['error'=>'Please sign in again. Your unsaved draft has been kept.'],401);header('Location: /login',true,303);exit;}
 if($path==='/logout'){
  if($method!=='POST'||!hash_equals($_SESSION['csrf'],$_POST['csrf']??'')){http_response_code(403);exit('Forbidden');}$_SESSION=[];session_destroy();setcookie(session_name(),'', ['expires'=>time()-3600,'path'=>'/','secure'=>!$local,'httponly'=>true,'samesite'=>'Strict']);header('Location: /login',true,303);exit;
 }
 if($path==='/api/notes'){
  if($method!=='POST')respond(['error'=>'Use POST.'],405);
  if(($_SERVER['HTTP_ORIGIN']??'')!==$origin||($_SERVER['HTTP_X_EXPENSES_NOTES']??'')!=='1'||!preg_match('~^application/json(?:\s*;|$)~i',$_SERVER['CONTENT_TYPE']??''))respond(['error'=>'Save notes from this website.'],403);
  $raw=file_get_contents('php://input',false,null,0,32769);if(strlen($raw)>32768)respond(['error'=>'The note is too large.'],413);
  $input=json_decode($raw,true,8,JSON_THROW_ON_ERROR);[$id,$text,$version]=validateNoteRequest($input);$rows=array_column(ledger()['transactions'],null,'id');if(!isset($rows[$id]))respond(['error'=>'Transaction not found.'],404);
  respond(['transaction_id'=>$id,'note'=>$notes->save($id,$text,$version,false,'web:'.$_SESSION['user'])]);
 }
 if(!in_array($method,['GET','HEAD'],true)){http_response_code(405);exit;}
 if($path==='/api/data'){
  if(($_SERVER['HTTP_SEC_FETCH_SITE']??'none')==='cross-site'||(isset($_SERVER['HTTP_ORIGIN'])&&$_SERVER['HTTP_ORIGIN']!==$origin))respond(['error'=>'Forbidden.'],403);
  $data=ledger();$saved=$notes->allWeb();foreach($data['transactions'] as &$row)$row['note']=$saved[$row['id']]??emptyTransactionNote();unset($row);$data['meta']['hosted']=true;$data['meta']['timezone']=$siteConfig['timezone']??'UTC';$data['meta']['signed_in_as']=$_SESSION['user'];respond($data);
 }
 if(preg_match('~^/transactions/([1-9][0-9]*)$~D',$path,$match)){
  $rows=array_column(ledger()['transactions'],null,'id');$row=$rows[(int)$match[1]]??null;if(!$row){http_response_code(404);exit('Transaction not found.');}$note=$notes->allWeb()[$row['id']]??emptyTransactionNote();
  header('Content-Type: text/html; charset=utf-8');echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Transaction · My expenses</title><link rel="stylesheet" href="/login.css"></head><body><main class="login transaction-details"><a href="/">← My expenses</a><h1>'.html($row['merchant']).'</h1><dl>';foreach(['Date'=>$row['date'],'Account'=>$row['account'],'Category'=>$row['category']??'Uncategorized','Amount'=>number_format($row['amount']/100,2).' '.$row['currency'],'Direction'=>$row['type'],'Bank description'=>$row['description'],'Note'=>$note['text']] as $label=>$value)echo '<dt>'.html($label).'</dt><dd>'.nl2br(html($value)).'</dd>';echo '</dl><p>Add or edit notes from the transaction’s note icon in the dashboard.</p></main></body></html>';exit;
 }
 $files=['/'=>['index.html','text/html; charset=utf-8'],'/app.js'=>['app.js','text/javascript; charset=utf-8'],'/reporting.js'=>['reporting.js','text/javascript; charset=utf-8'],'/category-appearance.js'=>['category-appearance.js','text/javascript; charset=utf-8'],'/style.css'=>['style.css','text/css; charset=utf-8'],'/vendor/chart.umd.js'=>['vendor/chart.umd.js','text/javascript; charset=utf-8'],'/fonts/roboto.woff2'=>['fonts/roboto.woff2','font/woff2'],'/note-icon.svg'=>['note-icon.svg','image/svg+xml'],'/fixed-lock.svg'=>['fixed-lock.svg','image/svg+xml']];
 if(preg_match('~^/logos/[a-z0-9-]+\.(svg|png|ico|jpg|webp)$~D',$path,$match)){$manifest=json_decode(file_get_contents(__DIR__.'/app/logos/sources.json'),true,512,JSON_THROW_ON_ERROR);foreach($manifest['brands'] as $brand)if(($brand['path']??'')===$path&&($brand['status']??'')==='available'){$types=['svg'=>'image/svg+xml','png'=>'image/png','ico'=>'image/x-icon','jpg'=>'image/jpeg','webp'=>'image/webp'];$files[$path]=[ltrim($path,'/'),$types[$match[1]]];break;}}
 if(preg_match('~^/category-icons/[a-z0-9-]+\.svg$~D',$path)){$manifest=json_decode(file_get_contents(__DIR__.'/app/category-icons/sources.json'),true,512,JSON_THROW_ON_ERROR);foreach($manifest['icons'] as $icon)if($icon['path']===$path){$files[$path]=[ltrim($path,'/'),'image/svg+xml'];break;}}
 if(!isset($files[$path])){http_response_code(404);exit('Not found');}
 [$file,$type]=$files[$path];header('Content-Type: '.$type);if($method==='HEAD')exit;
 if($path==='/'){
  $page=file_get_contents(__DIR__.'/app/index.html');$page=str_replace('Saved on this computer','Saved securely on this website',$page);$page=preg_replace('~<a href="http://127\.0\.0\.1:8080".*?</a>~','',$page);
  $logout='<form class="logout-form" method="post" action="/logout"><input type="hidden" name="csrf" value="'.html($_SESSION['csrf']).'"><button class="logout-button" type="submit">Sign out · '.html($_SESSION['user']).'</button></form>';
  $page=str_replace('<div class="sidebar-foot">','<div class="sidebar-foot">'.$logout,$page);$page=str_replace('Loading your local ledger','Loading your ledger',$page);echo $page;exit;
 }
 readfile(__DIR__.'/app/'.$file);
}catch(NoteConflict $error){respond(['error'=>$error->getMessage(),'note'=>$error->current],409);}
catch(JsonException|InvalidArgumentException $error){respond(['error'=>'The request was not valid. Please check the note and try again.'],400);}
catch(Throwable $error){error_log('Expenses request failed: '.$error->getMessage());if(str_starts_with($path,'/api/'))respond(['error'=>'The dashboard is temporarily unavailable. Your draft has been kept.'],503);http_response_code(503);echo 'My expenses is temporarily unavailable. Please try again shortly.';}
