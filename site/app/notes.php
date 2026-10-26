<?php
declare(strict_types=1);

final class NoteConflict extends RuntimeException{
 public function __construct(public readonly array $current){parent::__construct('This note changed in another window.');}
}
function emptyTransactionNote():array{return ['text'=>'','version'=>0,'status'=>'empty','updated_at'=>null];}
function validateNoteRequest(array $input):array{
 if(array_diff(array_keys($input),['transaction_id','text','version'])||!isset($input['transaction_id'],$input['text'],$input['version'])||!is_int($input['transaction_id'])||$input['transaction_id']<1||!is_int($input['version'])||$input['version']<0||$input['version']>=PHP_INT_MAX||!is_string($input['text']))throw new InvalidArgumentException('Provide a transaction, note text and saved version.');
 $text=str_replace(["\r\n","\r"],"\n",$input['text']);
 if(!mb_check_encoding($text,'UTF-8')||mb_strlen($text,'UTF-8')>5000||preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/',$text))throw new InvalidArgumentException('Use plain text up to 5,000 characters, without control characters.');
 return [$input['transaction_id'],trim($text),$input['version']];
}
final class TransactionNotesStore{
 public function __construct(private readonly string $path){}
 private function open(bool $write):SQLite3{
  $db=new SQLite3($this->path,$write?SQLITE3_OPEN_READWRITE|SQLITE3_OPEN_CREATE:SQLITE3_OPEN_READONLY);$db->enableExceptions(true);$db->busyTimeout(5000);
  if($write){$db->exec('PRAGMA synchronous=FULL');$db->exec('CREATE TABLE IF NOT EXISTS notes (transaction_id INTEGER PRIMARY KEY, text TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL)');$db->exec('CREATE TABLE IF NOT EXISTS revisions (transaction_id INTEGER NOT NULL, version INTEGER NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL, author TEXT NOT NULL, PRIMARY KEY(transaction_id,version))');}
  else $db->exec('PRAGMA query_only=ON');
  return $db;
 }
 private static function note(array $row):array{return ['text'=>$row['text'],'version'=>(int)$row['version'],'status'=>$row['status'],'updated_at'=>$row['updated_at']];}
 public function all():array{
  if(!is_file($this->path))return [];$db=$this->open(false);$result=$db->query('SELECT * FROM notes');$notes=[];
  while($row=$result->fetchArray(SQLITE3_ASSOC))$notes[(int)$row['transaction_id']]=self::note($row);$db->close();return $notes;
 }
 public function history(int $id):array{
  if(!is_file($this->path))return [];$db=$this->open(false);$query=$db->prepare('SELECT * FROM revisions WHERE transaction_id=:id ORDER BY version');$query->bindValue(':id',$id,SQLITE3_INTEGER);$result=$query->execute();$rows=[];
  while($row=$result->fetchArray(SQLITE3_ASSOC))$rows[]=array_merge(self::note($row),['author'=>$row['author']]);$db->close();return $rows;
 }
 /** Only website-authored content is eligible for display or user-note review. */
 public function allWeb():array{
  $state=$this->exportState();$web=[];
  foreach($state['revisions'] as $revision){if($revision['author']==='assistant-review')continue;$web[$revision['transaction_id']]=str_starts_with($revision['author'],'web:');}
  return array_filter($this->all(),fn($note,$id)=>$web[$id]??false,ARRAY_FILTER_USE_BOTH);
 }
 public function save(int $id,string $text,int $expectedVersion,bool $reviewed=false,string $author='user'):array{
  [$id,$text,$expectedVersion]=validateNoteRequest(['transaction_id'=>$id,'text'=>$text,'version'=>$expectedVersion]);
  $db=$this->open(true);$db->exec('BEGIN IMMEDIATE');
  try{
   $query=$db->prepare('SELECT * FROM notes WHERE transaction_id=:id');$query->bindValue(':id',$id,SQLITE3_INTEGER);$row=$query->execute()->fetchArray(SQLITE3_ASSOC);$current=$row?self::note($row):emptyTransactionNote();
   if($current['version']!==$expectedVersion)throw new NoteConflict($current);
   if($reviewed){if(!$current['text'])throw new InvalidArgumentException('There is no saved note to review.');$text=$current['text'];}
   if((!$reviewed&&$current['text']===$text)||($reviewed&&$current['status']==='reviewed')){$db->exec('COMMIT');return $current;}
   $note=['text'=>$text,'version'=>$expectedVersion+1,'status'=>$text===''?'empty':($reviewed?'reviewed':'pending'),'updated_at'=>gmdate(DATE_ATOM)];
   foreach(['INSERT INTO notes(transaction_id,text,version,status,updated_at) VALUES(:id,:text,:version,:status,:updated_at) ON CONFLICT(transaction_id) DO UPDATE SET text=excluded.text,version=excluded.version,status=excluded.status,updated_at=excluded.updated_at','INSERT INTO revisions(transaction_id,text,version,status,updated_at,author) VALUES(:id,:text,:version,:status,:updated_at,:author)'] as $sql){
    $statement=$db->prepare($sql);$statement->bindValue(':id',$id,SQLITE3_INTEGER);foreach($note as $key=>$value)$statement->bindValue(':'.$key,$value,$key==='version'?SQLITE3_INTEGER:SQLITE3_TEXT);if(str_contains($sql,':author'))$statement->bindValue(':author',$reviewed?'assistant-review':$author,SQLITE3_TEXT);$statement->execute();
   }
   $db->exec('COMMIT');return $note;
  }catch(Throwable $error){$db->exec('ROLLBACK');throw $error;}finally{$db->close();}
 }
 public function exportState():array{
  if(!is_file($this->path))return ['notes'=>[],'revisions'=>[]];$db=$this->open(false);$out=['notes'=>[],'revisions'=>[]];
  foreach(['notes'=>'transaction_id','revisions'=>'transaction_id,version'] as $table=>$order){$result=$db->query('SELECT * FROM '.$table.' ORDER BY '.$order);while($row=$result->fetchArray(SQLITE3_ASSOC)){$row['transaction_id']=(int)$row['transaction_id'];$row['version']=(int)$row['version'];$out[$table][]=$row;}}
  $db->close();return $out;
 }
 /** Mirror the website's authoritative immutable revisions without overwriting conflicts. */
 public function importState(array $state):void{
  if(!isset($state['notes'],$state['revisions'])||!is_array($state['notes'])||!is_array($state['revisions']))throw new InvalidArgumentException('Invalid remote notes state');
  $db=$this->open(true);$db->exec('BEGIN IMMEDIATE');
  try{
   $remoteIds=array_column($state['notes'],null,'transaction_id');$existing=$db->query('SELECT transaction_id FROM notes');while($row=$existing->fetchArray(SQLITE3_ASSOC))if(!isset($remoteIds[(int)$row['transaction_id']]))throw new RuntimeException('The website is missing a locally saved note; both copies have been preserved.');
   foreach($state['revisions'] as $row){
    validateNoteRequest(['transaction_id'=>$row['transaction_id']??null,'text'=>$row['text']??null,'version'=>$row['version']??null]);
    if($row['version']<1||!in_array($row['status']??'', ['pending','reviewed','empty'],true)||!is_string($row['updated_at']??null)||!is_string($row['author']??null))throw new InvalidArgumentException('Invalid remote revision');
    $q=$db->prepare('SELECT * FROM revisions WHERE transaction_id=:id AND version=:version');$q->bindValue(':id',$row['transaction_id'],SQLITE3_INTEGER);$q->bindValue(':version',$row['version'],SQLITE3_INTEGER);$saved=$q->execute()->fetchArray(SQLITE3_ASSOC);
    if($saved){foreach(['text','status','updated_at','author'] as $key)if($saved[$key]!==$row[$key])throw new RuntimeException('A local and website note revision conflict; both copies have been preserved.');continue;}
    $q=$db->prepare('SELECT COALESCE(MAX(version),0) FROM revisions WHERE transaction_id=:id');$q->bindValue(':id',$row['transaction_id'],SQLITE3_INTEGER);if($row['version']!==(int)$q->execute()->fetchArray(SQLITE3_NUM)[0]+1)throw new RuntimeException('Remote note revision history has a gap');
    $q=$db->prepare('INSERT INTO revisions(transaction_id,text,version,status,updated_at,author) VALUES(:transaction_id,:text,:version,:status,:updated_at,:author)');foreach(['transaction_id','text','version','status','updated_at','author'] as $key)$q->bindValue(':'.$key,$row[$key],in_array($key,['transaction_id','version'],true)?SQLITE3_INTEGER:SQLITE3_TEXT);$q->execute();
   }
   foreach($state['notes'] as $row){
    validateNoteRequest(['transaction_id'=>$row['transaction_id']??null,'text'=>$row['text']??null,'version'=>$row['version']??null]);
    $q=$db->prepare('SELECT * FROM notes WHERE transaction_id=:id');$q->bindValue(':id',$row['transaction_id'],SQLITE3_INTEGER);$saved=$q->execute()->fetchArray(SQLITE3_ASSOC);
    if($saved&&(int)$saved['version']>$row['version'])throw new RuntimeException('The local note is newer than the website; both copies have been preserved.');
    $q=$db->prepare('SELECT * FROM revisions WHERE transaction_id=:id AND version=:version');$q->bindValue(':id',$row['transaction_id'],SQLITE3_INTEGER);$q->bindValue(':version',$row['version'],SQLITE3_INTEGER);$revision=$q->execute()->fetchArray(SQLITE3_ASSOC);if(!$revision||array_diff_assoc(array_intersect_key($row,array_flip(['text','status','updated_at'])),$revision))throw new RuntimeException('Remote note does not match its saved revision');
    $q=$db->prepare('INSERT INTO notes(transaction_id,text,version,status,updated_at) VALUES(:transaction_id,:text,:version,:status,:updated_at) ON CONFLICT(transaction_id) DO UPDATE SET text=excluded.text,version=excluded.version,status=excluded.status,updated_at=excluded.updated_at');foreach(['transaction_id','text','version','status','updated_at'] as $key)$q->bindValue(':'.$key,$row[$key],in_array($key,['transaction_id','version'],true)?SQLITE3_INTEGER:SQLITE3_TEXT);$q->execute();
   }
   $db->exec('COMMIT');
  }catch(Throwable $error){$db->exec('ROLLBACK');throw $error;}finally{$db->close();}
 }
}
