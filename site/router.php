<?php
$remote=__DIR__.'/.private/remote.json';
if(is_file($remote)){
 $origin=json_decode(file_get_contents($remote),true)['origin']??'';
 if(!preg_match('~^https://[a-zA-Z0-9.-]+(?::[0-9]+)?$~D',$origin)){http_response_code(503);exit;}
 if(($_SERVER['REQUEST_METHOD']??'GET')!=='GET'){http_response_code(409);exit('Use the hosted website.');}
 header('Location: '.$origin.'/',true,302);exit;
}
require __DIR__.'/index.php';
