---
title: "Making sense of Elixir (improper) lists"
date: "2021-03-03"
tags:
  - elixir
---

Deep dive into Elixir lists, trying to understand improper lists from first principles.

<!-- excerpt -->

## Introduction

In Elixir, we can pattern match a list with `[head | tail] = list`, where `head` is the first element, and `tail` is a list with the rest of the elements. We can prepend to a list with a similar syntax:

```elixir
iex> list = [1, 2, 3, 4]
iex> [5 | list]
[5, 1, 2, 3, 4]
```

We can also join two lists with the `++` operator:

```elixir
iex> left = [1, 2, 3, 4]
iex> right = [5, 6, 7, 8]
iex> left ++ right
[1, 2, 3, 4, 5, 6, 7, 8]
```

But what happens when we try to _append_ to a list?

```elixir
iex> list = [1, 2, 3, 4]
iex> list ++ 5
[1, 2, 3, 4 | 5]
```

Huh. It _kind of_ worked, but there's a weird `|` symbol before the last element.
Moreover, if we try to use a function like `Enum.sum/1`, things will break:

```
iex> Enum.sum([1, 2, 3, 4 | 5])
** (FunctionClauseError) no function clause matching in Enum."-sum/1-lists^foldl/2-0-"/3
```

We get a slightly different result if we try with the `[head | tail]` syntax:

```elixir
iex> list = [1, 2, 3, 4]
iex> [list | 5]
[[1, 2, 3, 4] | 5]
```

But it's still not exactly what we want.

If we search the internets, we would probably find an answer like:

> What you see there is an improper list. (linked) Lists in elixir are made of a term and a pointer to the next element in the linked list, called a cons cell. Lists where the second element of the last cell is not the empty list is called an improper list.

The Elixir docs on lists provide a similar description:

> Similarly, we could write the list [1, 2, 3] using only such pairs (called cons cells):

```elixir
[1 | [2 | [3 | []]]]
[1, 2, 3]
```

> Some lists, called improper lists, do not have an empty list as the second element in the last cons cell:

```elixir
[1 | [2 | [3 | 4]]]
[1, 2, 3 | 4]
```

With this knowledge, we could say to ourselves that "If we want to append to a list, we need to make sure the last element is a list too", write something in the lines of `list ++ [5]` andn call it a day. So, in a nutshell, lists are linked lists, the last element of the last cell needs to be the empty list in order to be a _proper_ list, otherwise it's an _improper_ list, and most of the time you don't want improper lists.

But why does Elixir allow us to build improper lists so easily -accidentally even- if we are almost immediately told to not use them? What's their purpose?

In the following paragraphs I will try to explain the origin of lists in Erlang from it's most basic elements, some differences in the erlang and elixir terminology, and how clever usage of improper lists allows erlang to optimize the creation of data sequences that wouldn't be possible with proper lists.

## Cons cells

Many of the Erlang developers back in the day were lisp hackers, and they drew a lot of inspiration from lisps when disigning lists.

One of the most fundamental functions in lisp is `cons`: it **cons**tructs a memory object pointing to two elements. It basically builds _pair_, also known as a _cons cell_. It's used as `(cons a b)` and it's usually read as _"to cons a onto b"_, where `a` is the first element -also known as head or car(**c**ontents of the **a**ddress part of the **r**egister)- and `b` is the second element -the tail or cdr(**c**ontents of the **d**ecrement part of the **register**). For the rest of the article I will call them `head` and `tail` respectively, which are the terms most commonly used in Elixir and Erlang.

There's a special notation for cons cells called _dotted pairs_ that represent the head and the tail more explicitly: `(a . b)`. In the same spirit, the syntax for creating a cons cell in Elixir is `[a | b]`, where the pipe `|`, commonly referred to as the _cons operator_ is akin to the dot in dotted pairs.

If you want to get the head or the tail of a cons cell, you can use the `hd/1` and
`tl/2` functions respectively:

```elixir
iex> cons = [:a | :b]
iex> hd cons
:a
iex> tl cons
:b
```

Or you could also just pattern match against it:

```elixir
iex> [head | tail] = cons
iex> head
:a
iex> tail
:b
```

This was showcased at the start of the article, but note this time we are now
working at a more basic level, where head and tail can be anything.

### Cons cells vs tuples

So far one could argue "why use cons cells when they're identical 2-tuples? Why not just have tuples?".
The main difference lies in their memory layout, as explained in [BEAM VM
Wisdoms](http://beam-wisdoms.clau.se/en/latest/indepth-memory-layout.htm). A cons cells in the heap contains two words pointing the head and the tail respectively. In the case of lists the tail points to the next cons cell, which makes it easy to connect the tail of a cons cell to an existing list and reuse existing data.
On the other hand, a tuple uses one word in the heap as a header and the rest of words correspond to the tuple elements. This allows tuples to have constant time access at an arbitraty index, but makes changing it's size a more expensive operation. Because of cons cells lack of a header word, they also use less memory, which may be noticeable with large lists.
A quick and dirty demonstration of this difference can be done with `:erts_debug.size/1`, which returns the size of a term in words:

```
iex> :erts_debug.size([:a |:b])
2
iex> :erts_debug.size({:a, :b})
3
```

---

So cons cells are ordered pair, and that's pretty much all there is to them. Things get more interesting when used to build more complex data structures.

## Lists and the empty element

So, we now know what cons cells are, bot how do we build lists with the? We have the `head` be any term, and make the `tail` point to the next cons cell in the linked list. If we were to write a typespec for it, it would look something like
`list :: [term | list]`.

So if we have `1`, `2` and `3`, then `1` points to `2`, then to `3`. We could
write that as `[1 | [2 | 3]]`, but while that indeed creates a sequence, tails are required to be cons cells, but how do we construct them? The last element is a `3`, but we can't build a cons cells out of one element, we need two. Moreover, in the above typespec, there's no way to tell when the list stops as it keeps pointing to itself, infinitely. We're missing a _terminal element_ in our definition.

This terminal element is usually called `nil`, and with it our typespec would look like this: `list :: nil | [term | list]` Which reads as "A list is either the terminal element, or a cons cell where the head is any term and the tail is a list". In Erlang there's no concept of `nil`(in it's syntax), as it would be treated as an atom, so it is represented by a pair of square brackets `[]`, and so the spec would really look like `list :: [] | [term | list]`.

The recursive nature of the data structure hints us to a recursive solution if we want to traverse it, so if we'd want to write a function to find an element that matches a predicate, it would look like this:

```elixir
def find([], _), do: {:error, :not_found}
def find([head | tail], predicate) do
  if predicate.(head) do
	{:ok, head}
  else
    find(tail, predicate)
  end
end
```

Note that the function headers match the two possible values for a list: a cons cell or the `nil` element(`[]`).

Funnily enough, Elixir _does_ have a concept of `nil`, which is an atom with the special property of being, in combination with the atom `false`, the only falsy values in the language.

So, the `[]` value would be the empty list, except it actually isn't. As far as I
know, it's a special value whose only purpose is to be the terminal element for this kind of recursive data structures.

If you try to check that `[]` is a list, you would get a positive result:

```elixir
iex> is_list([])
true
```

But that's because `[]` is one of the two possible values for a list. There's a
curious fact about the way `[]` works, and we cant find a hint by looking at the order of the data types when sorted.

In the elixir docs we are told this:

> The reason we can compare different data types is pragmatism. Sorting algorithms don’t need to worry about different data types in order to sort. The overall sorting order is defined below:
> `number < atom < reference < function < port < pid < tuple < map < list < bitstring`

So far we don't see anything weird, and there's just the `list` type mentioned, so we could think that `[]` is indeed a list, nothing seems to say the opposite.
However, if we look at the same explanation but in the Erlang docs:

> The following order is defined:
> `number < atom < reference < fun < port < pid < tuple < map < nil < list < bit string`

There's a subtle difference: there's a type, `nil`, that's listed as a separate type from `list`. The docs further explain:

> nil in the previous expression represents the empty list ([]), which is regarded as a separate type from list/0. That is why nil < list.

Even more interesting is the fact that there exists a dedicated opcode in the BEAM to check for `nil`, as shown in the [BEAM Instructions](http://beam-wisdoms.clau.se/en/latest/indepth-beam-instructions.html) section of BEAM VM Wisdoms, and also recently showcased by [Isaac Yonemoto](https://twitter.com/DNAutics) in his [is_nil BEAM opcode for Elixirists](nebDOqU0TJ0) video.

This is a minor detail, really, but I find it interesting because it's one of those cases where Erlang and Elixir differ in their terminology: `nil` means completely different things for each language, and the terminal element is represented as `[]` by both, so we'll stick to it from now on.

So, back to our lists. Let's remind ourselves the lists type: `list :: [] | [term | list]`
Based on this, our list with the elements `1`, `2` and `3` would be written as
`[1 | [2 | [3 | []]]]`, and we arrived at the same expression showcased by the docs.
Of course, manually writing lists as a succession of cons cells is cumbersome and prone to errors, so usually an alternative syntax is provided to build lists:
`[1, 2, 3]`. This is the syntax we're used to and use every day.

But since lists are a essentially nested cons cells, nothing stops us from creating `[1 | [2 | 3]]`(or `[1, 2 | 3]` like we did before. That's a perfectly valid data structure, it's just not a list as we defined it, it lacks the terminal element `[]` at the end of the chain, and so it receives the name of _improper_ list.

### Improper lists

So, improper lists are just lists that lack the `[]` as a tail for their last cons cell. We could even argue that improper lists are any combination of cons cells that are not a list, so even `[[1 | 2] | [3 | 4]]`, which is a binary tree representation, would be an improper list, too.
When we use, for instance, the `++` operator, it essentially takes the right hand side and puts it in place of the terminal element of the left hand side.
If we have the list `[1, 2]`, that is `[1 | [2 | []]]` and we want to append `[3, 4]` to it, what happens when you do `[1, 2] ++ [3, 4]` is that the `[]` in `[2 | []]` get's replaced by `[3, 4]`, resulting in the list `[1, 2, 3, 4]`(remember how we said cons cells make it easy to connect the tail of a cons cell to an existing list?). Note that to find the terminal element we need to traverse the whole list, so appends will have a linear time complexity.
Prepending to a list is even easier, as we just need to create a new cons cell that points to the existing list, and is done in constant time:

```elixir
iex> list = [1, 2, 3]
iex> [0 | list]
[0, 1, 2, 3]
```

If we try to append `3` to `[1, 2]`, doing `[1, 2] ++ 3` will return `[1, 2 | 3]`; the `[]` was replace by `3`, thus turning it into an improper list, as hinted by the `|` at the end. In general, whenever you see the pipe at the end of a list it means you've done something wrong and accidentally created an improper list.
At this point, the reason you need to wrap a value in a list before appending it, ie: `[1, 2] ++ [3]` should be more apparent.

## Improper lists as an optimization technique

We've already seen what makes a list(cons cells and the terminal element), and have seen a bit of the properties of two of their most common operations: append and prepend.

We said that appending to a linked list has linear time complexity. This means that the larger the list, the more it takes to append an element to it, or to join two lists together. If we need to append a large ammount of items, one by one, to a list, we would be in trouble.

Let's say we're building a large list by appending elements to it to write to a file or any other kind of IO operation. For the sake of demonstration we'll just use a sequence of strings, but in real life this would be some non trivial data.
A first approximation would be:

```elixir
Enum.reduce(~w[a b c d e f], [], fn n, acc ->
  acc ++ [n]
end)
["a", "b", ...]
```

However, we're traversing the whole accumulator in each iteration. We could do better by building the list in reverse and correcting the ordering afterwards:

```elixir
Enum.reduce(~w[a b c d e f], [], fn n, acc ->
  [n | acc]
end)
|> Enum.reverse()
["a", "b", ...]
```

However, this would still be slow for very large lists.

Luckily, there's a clever trick we can use by taking advantage of improper lists.
Remember that lists are basically nested cons cells, and that the creation of cons cells happens in constant time. We could exploit this fact by consing the new elements at the tail instead of the head:

```elixir
Enum.reduce(~w[a b c d e f], [], fn n, acc ->
  [acc | n]
end)
[[[["a"] | "b"] | "c"] | ... ]
```

Of course this is no longer a proper list and we end up with a funny nesting at the head of the cons cells, but we're able to append elements in constant time!
We can also prepend to this improper list in constant time:

```elixir
["zzz" | [[["a"] | "b"] | "c"]]
```

When we have this kind of combination of cons cells, where the terminals are either numbers from `0` to `255` and binaries, arbitrarily nested, we have what's known as an "IO List". At first they may seem like a lot of gibberish, with lots of nesting and hard to traverse. In most cases this is true, but when you have to join a large number of binaries where there may also be a lot of repetition, this technique has huge benefits.

As a bonus point, many of the lower level erlang functions know how to handle iolists, so for instance the above io list can be printed as a binary by doing

```elixir
iex> :erlang.iolist_to_binary ["zzz" | [[["a"] | "b"] | "c"]]
"zzzabc"
```

There's an article by Evan Miller called [Elixir RAM and the Template of DOOM](https://www.evanmiller.org/elixir-ram-and-the-template-of-doom.html) that does a really good job on demonstrating the issues with concatenating lots of repeated data and how IO lists can greatly increase performance in those cases.

## Conclusions

Through this article we've learned two of the most basic, and often overlooked, primitives in Elixir, namely the cons cell and the empty list. We've learned how lists are built from first principles, how they're a special arrangement of cons cells and `[]`, and why even if improper lists can look like a bug at first glance, they're an integral part of the platform, powering many of the lower level applications in the BEAM.

At the end of the day, most of these details aren't needed for your day to day Elixir coding, but I hope this knowledge will provide you with a more solid understanding of the language, so the next time you see the `|` in your lists you will know how to *proper*ly read it.
